const { MonitorType } = require("./monitor-type");
const { UP } = require("../../src/util");
const dgram = require("node:dgram");
const { lookup } = require("node:dns/promises");
const net = require("node:net");
const { ConditionVariable } = require("../monitor-conditions/variables");
const { defaultNumberOperators } = require("../monitor-conditions/operators");
const { ConditionExpressionGroup } = require("../monitor-conditions/expression");
const { evaluateExpressionGroup } = require("../monitor-conditions/evaluator");

const NTP_EPOCH_OFFSET_SECONDS = 2208988800;
const NTP_PACKET_SIZE = 48;
const NTP_DEFAULT_PORT = 123;
const LI_ALARM = 3;
const MODE_SERVER = 4;

class NtpMonitorType extends MonitorType {
    name = "ntp";

    supportsConditions = true;

    conditionVariables = [
        new ConditionVariable("stratum", defaultNumberOperators),
        new ConditionVariable("offset_ms", defaultNumberOperators),
        new ConditionVariable("delay_ms", defaultNumberOperators),
    ];

    /**
     * @inheritdoc
     */
    async check(monitor, heartbeat, _server) {
        const result = await this.queryServer(monitor.hostname, monitor.port, monitor.timeout);
        const message =
            `Stratum ${result.stratum} | Offset ${result.offsetMs.toFixed(2)} ms | Delay ${result.delayMs.toFixed(2)} ms`;

        const conditions = monitor.conditions ? ConditionExpressionGroup.fromMonitor(monitor) : null;
        const hasConditions = conditions && conditions.children && conditions.children.length > 0;

        if (hasConditions) {
            const conditionsResult = evaluateExpressionGroup(conditions, {
                stratum: result.stratum,
                offset_ms: result.offsetMs,
                delay_ms: result.delayMs,
            });

            if (!conditionsResult) {
                throw new Error(`NTP conditions not met - ${message}`);
            }
        }

        heartbeat.status = UP;
        heartbeat.msg = message;
        heartbeat.ping = Math.round(result.roundTripMs);
    }

    /**
     * Query an NTP server and extract timing information.
     * @param {string} hostname Hostname or IP address of the NTP server
     * @param {number|string} port UDP port
     * @param {number|string} timeoutSeconds Timeout in seconds
     * @returns {Promise<{stratum: number, offsetMs: number, delayMs: number, roundTripMs: number}>} Parsed NTP timing data
     */
    async queryServer(hostname, port, timeoutSeconds) {
        const targetPort = Number(port) || NTP_DEFAULT_PORT;
        const timeoutMs = Math.max(1, Number(timeoutSeconds) || 5) * 1000;
        const { address, family } = await this.resolveAddress(hostname);
        const socket = dgram.createSocket(family === 6 ? "udp6" : "udp4");

        return await new Promise((resolve, reject) => {
            const packet = Buffer.alloc(NTP_PACKET_SIZE);
            packet[0] = 0x23; // LI=0, VN=4, Mode=3 (client)

            const requestTimeMs = Date.now();
            this.writeTimestamp(packet, 40, requestTimeMs);

            const timeoutId = setTimeout(() => {
                socket.close();
                reject(new Error(`Timeout after ${timeoutMs / 1000}s`));
            }, timeoutMs);

            socket.once("error", (error) => {
                clearTimeout(timeoutId);
                socket.close();
                reject(error);
            });

            socket.once("message", (response) => {
                clearTimeout(timeoutId);
                socket.close();

                try {
                    const result = this.parseResponse(response, packet, requestTimeMs, Date.now());
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });

            socket.send(packet, targetPort, address, (error) => {
                if (error) {
                    clearTimeout(timeoutId);
                    socket.close();
                    reject(error);
                }
            });
        });
    }

    /**
     * Resolve the hostname to choose the correct UDP socket family.
     * @param {string} hostname Hostname or IP address
     * @returns {Promise<{address: string, family: number}>} Resolved network address and IP family
     */
    async resolveAddress(hostname) {
        const ipFamily = net.isIP(hostname);
        if (ipFamily) {
            return {
                address: hostname,
                family: ipFamily,
            };
        }

        return await lookup(hostname);
    }

    /**
     * Parse an NTP server response.
     * @param {Buffer} response Server response packet
     * @param {Buffer} request Original request packet
     * @param {number} requestTimeMs Client transmit time in milliseconds
     * @param {number} responseTimeMs Client receive time in milliseconds
     * @returns {{stratum: number, offsetMs: number, delayMs: number, roundTripMs: number}} Parsed timing and stratum data
     * @throws {Error} Throws when the server reply is malformed or not a valid synchronized NTP response
     */
    parseResponse(response, request, requestTimeMs, responseTimeMs) {
        if (response.length < NTP_PACKET_SIZE) {
            throw new Error(`Invalid NTP response length: ${response.length}`);
        }

        const leapIndicator = response[0] >> 6;
        const mode = response[0] & 0x07;
        const stratum = response[1];

        if (mode !== MODE_SERVER) {
            throw new Error(`Invalid NTP mode in response: ${mode}`);
        }

        if (leapIndicator === LI_ALARM) {
            throw new Error("NTP server is unsynchronized");
        }

        if (stratum === 0) {
            throw new Error(`NTP Kiss-o'-Death: ${response.toString("ascii", 12, 16).trim() || "unknown"}`);
        }

        if (stratum > 15) {
            throw new Error(`Invalid NTP stratum in response: ${stratum}`);
        }

        if (!request.subarray(40, 48).equals(response.subarray(24, 32))) {
            throw new Error("NTP originate timestamp mismatch");
        }

        const receiveTimeMs = this.readTimestamp(response, 32);
        const transmitTimeMs = this.readTimestamp(response, 40);

        if (receiveTimeMs === 0 || transmitTimeMs === 0) {
            throw new Error("NTP response did not contain valid timestamps");
        }

        const roundTripMs = responseTimeMs - requestTimeMs;
        const delayMs = roundTripMs - (transmitTimeMs - receiveTimeMs);
        const offsetMs = ((receiveTimeMs - requestTimeMs) + (transmitTimeMs - responseTimeMs)) / 2;

        return {
            stratum,
            offsetMs,
            delayMs,
            roundTripMs,
        };
    }

    /**
     * Write a Unix timestamp to an NTP packet.
     * @param {Buffer} packet Packet buffer
     * @param {number} offset Packet offset
     * @param {number} unixMs Timestamp in milliseconds
     * @returns {void} Nothing
     */
    writeTimestamp(packet, offset, unixMs) {
        const seconds = Math.floor(unixMs / 1000) + NTP_EPOCH_OFFSET_SECONDS;
        const fractionalMs = unixMs % 1000;
        const fraction = Math.floor((fractionalMs / 1000) * 2 ** 32);

        packet.writeUInt32BE(seconds >>> 0, offset);
        packet.writeUInt32BE(fraction >>> 0, offset + 4);
    }

    /**
     * Read an NTP timestamp from a packet into Unix milliseconds.
     * @param {Buffer} packet Packet buffer
     * @param {number} offset Packet offset
     * @returns {number} Unix timestamp in milliseconds
     */
    readTimestamp(packet, offset) {
        const seconds = packet.readUInt32BE(offset);
        const fraction = packet.readUInt32BE(offset + 4);

        if (seconds === 0 && fraction === 0) {
            return 0;
        }

        return (seconds - NTP_EPOCH_OFFSET_SECONDS) * 1000 + (fraction / 2 ** 32) * 1000;
    }
}

module.exports = {
    NtpMonitorType,
};
