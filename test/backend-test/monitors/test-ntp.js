const { describe, test } = require("node:test");
const assert = require("node:assert");
const dgram = require("node:dgram");
const { NtpMonitorType } = require("../../../server/monitor-types/ntp");
const { UP, PENDING } = require("../../../src/util");

/**
 * Start a UDP server for NTP monitor tests.
 * @param {(server: dgram.Socket, monitorType: NtpMonitorType) => (msg: Buffer, rinfo: dgram.RemoteInfo) => void} handlerFactory
 * Factory that returns the per-message handler for the UDP server
 * @returns {Promise<{server: dgram.Socket, port: number, monitorType: NtpMonitorType}>} Bound UDP server and monitor instance
 */
async function startNtpTestServer(handlerFactory) {
    const server = dgram.createSocket("udp4");
    const monitorType = new NtpMonitorType();

    server.on("message", handlerFactory(server, monitorType));

    await new Promise((resolve) => {
        server.bind(0, "127.0.0.1", resolve);
    });

    return {
        server,
        port: server.address().port,
        monitorType,
    };
}

/**
 * Close a UDP server.
 * @param {dgram.Socket} server UDP server
 * @returns {Promise<void>}
 */
async function closeServer(server) {
    await new Promise((resolve) => {
        server.close(resolve);
    });
}

/**
 * Create a valid NTP server response from a request packet.
 * @param {Buffer} request Incoming request packet
 * @param {NtpMonitorType} monitorType NTP monitor instance
 * @param {{stratum?: number, leapIndicator?: number}} options Response overrides
 * @returns {Buffer} NTP response packet
 */
function createNtpResponse(request, monitorType, options = {}) {
    const response = Buffer.alloc(48);
    const leapIndicator = options.leapIndicator ?? 0;
    const stratum = options.stratum ?? 2;
    const requestTimeMs = monitorType.readTimestamp(request, 40);

    response[0] = (leapIndicator << 6) | (4 << 3) | 4;
    response[1] = stratum;
    response[2] = 4;
    response[3] = 0xfa;
    response.write("TEST", 12, "ascii");
    request.copy(response, 24, 40, 48);
    monitorType.writeTimestamp(response, 32, requestTimeMs + 2);
    monitorType.writeTimestamp(response, 40, requestTimeMs + 4);

    return response;
}

describe("NtpMonitorType", () => {
    test("check() sets status to UP on a valid NTP response", async () => {
        const { server, port, monitorType } = await startNtpTestServer((socket, type) => (msg, rinfo) => {
            socket.send(createNtpResponse(msg, type), rinfo.port, rinfo.address);
        });

        const heartbeat = {
            msg: "",
            status: PENDING,
        };

        try {
            await monitorType.check(
                {
                    hostname: "127.0.0.1",
                    port,
                    timeout: 1,
                    conditions: "[]",
                },
                heartbeat,
                {}
            );
        } finally {
            await closeServer(server);
        }

        assert.strictEqual(heartbeat.status, UP);
        assert.match(heartbeat.msg, /^Stratum 2 \| Offset /);
        assert.ok(Number.isInteger(heartbeat.ping));
        assert.ok(heartbeat.ping >= 0);
    });

    test("check() supports conditions for numeric NTP fields", async () => {
        const conditions = JSON.stringify([
            {
                type: "expression",
                variable: "stratum",
                operator: "lte",
                value: "3",
            },
        ]);

        const { server, port, monitorType } = await startNtpTestServer((socket, type) => (msg, rinfo) => {
            socket.send(createNtpResponse(msg, type, { stratum: 3 }), rinfo.port, rinfo.address);
        });

        const heartbeat = {
            msg: "",
            status: PENDING,
        };

        try {
            await monitorType.check(
                {
                    hostname: "127.0.0.1",
                    port,
                    timeout: 1,
                    conditions,
                },
                heartbeat,
                {}
            );
        } finally {
            await closeServer(server);
        }

        assert.strictEqual(heartbeat.status, UP);
    });

    test("check() rejects malformed NTP responses", async () => {
        const { server, port, monitorType } = await startNtpTestServer((socket) => (_msg, rinfo) => {
            socket.send(Buffer.alloc(8), rinfo.port, rinfo.address);
        });

        try {
            await assert.rejects(
                monitorType.check(
                    {
                        hostname: "127.0.0.1",
                        port,
                        timeout: 1,
                        conditions: "[]",
                    },
                    {
                        msg: "",
                        status: PENDING,
                    },
                    {}
                ),
                new Error("Invalid NTP response length: 8")
            );
        } finally {
            await closeServer(server);
        }
    });

    test("check() rejects kiss-o'-death responses", async () => {
        const { server, port, monitorType } = await startNtpTestServer((socket, type) => (msg, rinfo) => {
            const response = createNtpResponse(msg, type, { stratum: 0 });
            response.write("RATE", 12, "ascii");
            socket.send(response, rinfo.port, rinfo.address);
        });

        try {
            await assert.rejects(
                monitorType.check(
                    {
                        hostname: "127.0.0.1",
                        port,
                        timeout: 1,
                        conditions: "[]",
                    },
                    {
                        msg: "",
                        status: PENDING,
                    },
                    {}
                ),
                new Error("NTP Kiss-o'-Death: RATE")
            );
        } finally {
            await closeServer(server);
        }
    });

    test("check() rejects when NTP conditions do not match", async () => {
        const conditions = JSON.stringify([
            {
                type: "expression",
                variable: "stratum",
                operator: "lt",
                value: "2",
            },
        ]);

        const { server, port, monitorType } = await startNtpTestServer((socket, type) => (msg, rinfo) => {
            socket.send(createNtpResponse(msg, type, { stratum: 2 }), rinfo.port, rinfo.address);
        });

        try {
            await assert.rejects(
                monitorType.check(
                    {
                        hostname: "127.0.0.1",
                        port,
                        timeout: 1,
                        conditions,
                    },
                    {
                        msg: "",
                        status: PENDING,
                    },
                    {}
                ),
                /NTP conditions not met/
            );
        } finally {
            await closeServer(server);
        }
    });
});
