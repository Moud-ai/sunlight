package com.moud.sunlight.mcp

import android.content.Context
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import com.moud.sunlight.vm.VmPaths
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * MCP (Model Context Protocol) server for Sunlight.
 *
 * Exposes the app's tools to external AI clients (Claude Desktop, Cursor, etc.)
 * via JSON-RPC 2.0 over HTTP (Streamable HTTP transport).
 */
class McpServerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SunlightMcpServer"

    // Store references accessible from inner classes/lambdas
    private val reactAppContext = reactContext
    private val TAG = McpServerModule.TAG
    private val STORAGE_KEY = McpServerModule.STORAGE_KEY

    private var serverThread: Thread? = null
    private var serverSocket: ServerSocket? = null
    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private var isRunning: Boolean = false
    private var currentPort: Int = 18789

    companion object {
        private const val STORAGE_KEY = "@sunlight_mcp_server"
        private const val DEFAULT_PORT = 18789
        const val TAG = "McpServerModule"
    }

    // ---------------------------------------------------------------------------
    // MCP protocol types (using JSONObject)
    // ---------------------------------------------------------------------------

    private data class McpTool(
        val name: String,
        val description: String,
        val inputSchema: JSONObject
    )

    private val TOOLS = listOf(
        McpTool(
            name = "web_search",
            description = "Search the web using SearXNG (bing, wikipedia, duckduckgo). Returns titles, URLs, and snippets.",
            inputSchema = JSONObject().apply {
                put("type", "object")
                put("properties", JSONObject().apply {
                    put("query", JSONObject().apply {
                        put("type", "string")
                        put("description", "The search query")
                    })
                    put("limit", JSONObject().apply {
                        put("type", "integer")
                        put("description", "Max results (1-10, default 5)")
                    })
                })
                put("required", JSONArray().put("query"))
            }
        ),
        McpTool(
            name = "vm_status",
            description = "Get the status of the Sunlight QEMU virtual machine.",
            inputSchema = JSONObject().apply {
                put("type", "object")
                put("properties", JSONObject())
            }
        ),
        McpTool(
            name = "vm_console",
            description = "Execute a command inside the Sunlight VM (Alpine Linux guest) and return the output.",
            inputSchema = JSONObject().apply {
                put("type", "object")
                put("properties", JSONObject().apply {
                    put("command", JSONObject().apply {
                        put("type", "string")
                        put("description", "Shell command to run in the VM")
                    })
                })
                put("required", JSONArray().put("command"))
            }
        )
    )

    // ---------------------------------------------------------------------------
    // Tool execution
    // ---------------------------------------------------------------------------

    @ReactMethod
    fun executeTool(name: String, argsJson: String, promise: Promise) {
        try {
            val args = JSONObject(argsJson)
            val result = when (name) {
                "web_search" -> executeWebSearch(args)
                "vm_status" -> getVmStatus()
                "vm_console" -> executeVmCommand(args)
                else -> JSONObject().put("error", "Unknown tool: $name")
            }
            promise.resolve(result.toString())
        } catch (e: Exception) {
            promise.reject("TOOL_ERROR", e.message, e)
        }
    }

    private fun executeWebSearch(args: JSONObject): JSONObject {
        val query = args.optString("query", "")
        val limit = args.optInt("limit", 5)
        if (query.isEmpty()) {
            return JSONObject().put("error", "query is required")
        }
        // Note: actual search is done via the gateway from JS side
        // This is a placeholder - the JS side calls the gateway directly
        return JSONObject().apply {
            put("results", JSONArray())
            put("note", "Search should be called via the gateway from JS")
        }
    }

    private fun getVmStatus(): JSONObject {
        try {
            val context = reactAppContext
            val vmDir = VmPaths.vmDir(context)
            val disk = VmPaths.disk(context)
            val kernel = VmPaths.kernel(context)
            val initrd = VmPaths.initrd(context)

            val map = WritableNativeMap().apply {
                putBoolean("qemuInstalled", VmPaths.qemuBinary(context).exists())
                putBoolean("kernelInstalled", kernel.exists())
                putBoolean("initrdInstalled", initrd.exists())
                putBoolean("diskExists", disk.exists())
                putBoolean("running", false) // Will be updated by VM module
                putDouble("storageUsed", VmPaths.vmDir(reactAppContext).listFiles()?.sumOf { it.length() }?.toDouble() ?: 0.0)
                putString("diskPath", disk.absolutePath)
            }
            return JSONObject(map.toString())
        } catch (e: Exception) {
            return JSONObject().put("error", e.message)
        }
    }

    private fun executeVmCommand(args: JSONObject): JSONObject {
        val command = args.optString("command", "")
        if (command.isEmpty()) {
            return JSONObject().put("error", "command is required")
        }
        // The actual VM execution is done via VmModule from JS
        // This is a placeholder
        return JSONObject().apply {
            put("error", "VM command should be executed via JS VmModule")
        }
    }

    // ---------------------------------------------------------------------------
    // HTTP server
    // ---------------------------------------------------------------------------

    @ReactMethod
    fun startServer(port: Int, promise: Promise) {
        synchronized(this) {
            if (isRunning) {
                promise.reject("ALREADY_RUNNING", "Server is already running on port $currentPort")
                return
            }
            currentPort = port
        }

        serverThread = Thread {
            try {
                serverSocket = ServerSocket(currentPort, 50, InetAddress.getByName("127.0.0.1"))
                isRunning = true
                Log.i(TAG, "MCP server started on port $currentPort")

                while (isRunning) {
                    try {
                        val clientSocket: Socket = serverSocket!!.accept()
                        executor.execute { handleClient(clientSocket) }
                    } catch (e: IOException) {
                        if (isRunning) {
                            Log.e(TAG, "Accept error", e)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Server error", e)
                isRunning = false
            }
        }.apply { start() }

        currentPort = port
        promise.resolve(true)
    }

    @ReactMethod
    fun stopServer(promise: Promise) {
        synchronized(this) {
            if (!isRunning) {
                promise.resolve(true)
                return
            }
            isRunning = false
        }

        try {
            serverSocket?.close()
        } catch (e: IOException) {
            Log.w(TAG, "Error closing server socket", e)
        }
        serverThread?.join(2000)
        promise.resolve(true)
    }

    @ReactMethod
    fun isRunning(promise: Promise) {
        promise.resolve(isRunning)
    }

    @ReactMethod
    fun getPort(promise: Promise) {
        promise.resolve(currentPort)
    }

    @ReactMethod
    fun getConfig(promise: Promise) {
        try {
            val context = reactAppContext
            val prefs = context.getSharedPreferences(STORAGE_KEY, Context.MODE_PRIVATE)
            val enabled = prefs.getBoolean("enabled", false)
            val port = prefs.getInt("port", 18789)
            promise.resolve(JSONObject().apply {
                put("enabled", enabled)
                put("port", port)
            }.toString())
        } catch (e: Exception) {
            promise.reject("CONFIG_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setConfig(enabled: Boolean, port: Int, promise: Promise) {
        try {
            val context = reactAppContext
            val prefs = context.getSharedPreferences(STORAGE_KEY, Context.MODE_PRIVATE)
            prefs.edit()
                .putBoolean("enabled", enabled)
                .putInt("port", port)
                .apply()
            currentPort = port
            if (enabled && !isRunning) {
                startServer(port, EmptyPromise())
            } else if (!enabled && isRunning) {
                stopServer(EmptyPromise())
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CONFIG_ERROR", e.message, e)
        }
    }

    private fun handleClient(socket: Socket) {
        try {
            val input = socket.getInputStream()
            val output = socket.getOutputStream()

            val buffer = ByteArrayOutputStream()
            val bufferArray = ByteArray(4096)
            var bytesRead = input.read(bufferArray)
            while (bytesRead != -1) {
                buffer.write(bufferArray, 0, bytesRead)
                val bytes = buffer.toByteArray()
                val bytesSize = bytes.size
                val endMarker = "\r\n\r\n".toByteArray(StandardCharsets.UTF_8)
                if (bytesSize >= endMarker.size) {
                    var match = true
                    for (i in 0 until endMarker.size) {
                        if (bytes[bytesSize - endMarker.size + i] != endMarker[i]) {
                            match = false
                            break
                        }
                    }
                    if (match) break
                }
                bytesRead = input.read(bufferArray)
            }

            val requestBody = buffer.toString(StandardCharsets.UTF_8)
            val response = processRequest(requestBody)
            val responseBytes = response.toByteArray(StandardCharsets.UTF_8)

            val responseStr = "HTTP/1.1 200 OK\r\n" +
                "Content-Type: application/json\r\n" +
                "Content-Length: ${responseBytes.size}\r\n" +
                "Connection: close\r\n\r\n"
            output.write(responseStr.toByteArray(StandardCharsets.UTF_8))
            output.write(responseBytes)
            output.flush()
        } catch (e: Exception) {
            Log.e(TAG, "Error handling client", e)
        } finally {
            try {
                socket.close()
            } catch (e: IOException) {
                Log.w(TAG, "Error closing client socket", e)
            }
        }
    }

    private fun processRequest(requestBody: String): String {
        return try {
            val req = JSONObject(requestBody)
            val id = req.opt("id") ?: 0
            val method = req.optString("method", "")
            val params = req.optJSONObject("params")

            val result = when (method) {
                "initialize" -> JSONObject().apply {
                    put("protocolVersion", "2025-03-26")
                    put("capabilities", JSONObject().put("tools", JSONObject() as Any))
                    put("serverInfo", JSONObject().apply {
                        put("name", "sunlight")
                        put("version", "1.3.1")
                    })
                }
                "tools/list" -> JSONObject().put("tools", JSONArray().apply {
                    for (tool in TOOLS) {
                        put(JSONObject().apply {
                            put("name", tool.name)
                            put("description", tool.description)
                            put("inputSchema", tool.inputSchema as Any)
                        })
                    }
                })
                "tools/call" -> {
                    val params = req.optJSONObject("params")
                    val toolName = params?.optString("name") ?: ""
                    val args = params?.optJSONObject("arguments") ?: JSONObject()
                    if (toolName.isEmpty()) {
                        throw IllegalArgumentException("Missing tool name")
                    }
                    val result = executeTool(toolName, args)
                    JSONObject().put("content", JSONArray().put(
                        JSONObject().apply {
                            put("type", "text")
                            put("text", result.toString())
                        }
                    ))
                }
                "ping" -> JSONObject()
                else -> throw IllegalArgumentException("Method not found: $method")
            }
            JSONObject().apply {
                put("jsonrpc", "2.0")
                put("id", id)
                put("result", result)
            }.toString()
        } catch (e: Exception) {
            JSONObject().apply {
                put("jsonrpc", "2.0")
                put("id", try { JSONObject(requestBody).opt("id") ?: 0 } catch (_: Throwable) { 0 })
                put("error", JSONObject().apply {
                    put("code", -32603)
                    put("message", e.message ?: "Internal error")
                })
            }.toString()
        }
    }

    private fun executeTool(name: String, args: JSONObject): JSONObject {
        return when (name) {
            "web_search" -> executeWebSearch(args)
            "vm_status" -> getVmStatus()
            "vm_console" -> executeVmCommand(args)
            else -> JSONObject().put("error", "Unknown tool: $name")
        }
    }

    override fun onCatalystInstanceDestroy() {
        stopServer(EmptyPromise())
        executor.shutdown()
        super.onCatalystInstanceDestroy()
    }

    // Helper classes for Promises
    private class EmptyPromise : Promise {
        override fun resolve(value: Any?) {}
        override fun reject(throwable: Throwable) {}
        override fun reject(throwable: Throwable, userInfo: com.facebook.react.bridge.WritableMap) {}
        override fun reject(message: String) {}
        override fun reject(code: String?, throwable: Throwable?) {}
        override fun reject(code: String?, message: String?) {}
        override fun reject(code: String?, message: String?, throwable: Throwable?) {}
        override fun reject(code: String?, userInfo: com.facebook.react.bridge.WritableMap) {}
        override fun reject(code: String?, throwable: Throwable?, userInfo: com.facebook.react.bridge.WritableMap) {}
        override fun reject(code: String?, message: String?, userInfo: com.facebook.react.bridge.WritableMap) {}
        override fun reject(code: String?, message: String?, throwable: Throwable?, userInfo: com.facebook.react.bridge.WritableMap?) {}
    }
}