package org.pca.app.enrollment

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.Socket

/**
 * TEST-ONLY minimal single-connection-at-a-time HTTP/1.1 responder, built on plain
 * `java.net.ServerSocket` rather than `com.sun.net.httpserver.HttpServer` -- the latter's
 * `jdk.httpserver` module is not resolvable from this project's unit-test compile classpath (AGP
 * restricts the JDK modules exposed there). Good enough to drive [HttpDeviceBootstrapApiClient]
 * against a real socket/real bytes-on-the-wire round trip without a mocking framework.
 */
class FakeHttpServer private constructor(private val serverSocket: ServerSocket) {
    val baseUrl: String = "http://127.0.0.1:${serverSocket.localPort}"
    @Volatile private var stopped = false
    private var thread: Thread? = null

    /** [respond] receives the captured request body (already fully read) and returns (status, body bytes). Never called for a connection that this server was told to drop instead (see [dropConnections]). */
    fun start(respond: (requestBody: String) -> Pair<Int, ByteArray>) {
        thread = Thread {
            while (!stopped) {
                val socket = try {
                    serverSocket.accept()
                } catch (e: Exception) {
                    break
                }
                try {
                    handleOneRequest(socket, respond)
                } catch (e: Exception) {
                    // A test deliberately causing a mid-response failure; ignore here, the client side assertion is what matters.
                } finally {
                    socket.close()
                }
            }
        }
        thread!!.isDaemon = true
        thread!!.start()
    }

    /** Accepts and immediately closes every connection without ever writing a response -- simulates a response lost in transit / connection reset mid-flight. */
    fun startAndDropEveryConnection() {
        thread = Thread {
            while (!stopped) {
                val socket = try {
                    serverSocket.accept()
                } catch (e: Exception) {
                    break
                }
                socket.close()
            }
        }
        thread!!.isDaemon = true
        thread!!.start()
    }

    private fun handleOneRequest(socket: Socket, respond: (String) -> Pair<Int, ByteArray>) {
        val input = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
        val requestLine = input.readLine() ?: return
        var contentLength = 0
        while (true) {
            val line = input.readLine() ?: break
            if (line.isEmpty()) break
            val parts = line.split(":", limit = 2)
            if (parts.size == 2 && parts[0].trim().equals("content-length", ignoreCase = true)) {
                contentLength = parts[1].trim().toIntOrNull() ?: 0
            }
        }
        val bodyChars = CharArray(contentLength)
        var read = 0
        while (read < contentLength) {
            val n = input.read(bodyChars, read, contentLength - read)
            if (n == -1) break
            read += n
        }
        val body = String(bodyChars, 0, read)

        val (status, responseBytes) = respond(body)
        val statusText = when (status) {
            200 -> "OK"
            201 -> "Created"
            400 -> "Bad Request"
            404 -> "Not Found"
            else -> "Server Error"
        }
        val output = socket.getOutputStream()
        output.write("HTTP/1.1 $status $statusText\r\n".toByteArray(Charsets.UTF_8))
        output.write("Content-Type: application/json\r\n".toByteArray(Charsets.UTF_8))
        output.write("Content-Length: ${responseBytes.size}\r\n".toByteArray(Charsets.UTF_8))
        output.write("Connection: close\r\n\r\n".toByteArray(Charsets.UTF_8))
        output.write(responseBytes)
        output.flush()
    }

    fun stop() {
        stopped = true
        runCatching { serverSocket.close() }
    }

    companion object {
        fun start(): FakeHttpServer = FakeHttpServer(ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1")))
    }
}
