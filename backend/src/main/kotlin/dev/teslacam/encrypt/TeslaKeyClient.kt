package dev.teslacam.encrypt

import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientResponseException

/** Frontend-facing wrapped-key item (camelCase JSON); id = root-relative file path. */
data class KeyItem(
    val id: String,
    val vin: String,
    val keyId: Long,
    val timestamp: Long,
    val wrappedKey: String, // base64, 44 bytes
    val publicKey: String,  // base64, 65 bytes
) {
    val storeKey: String get() = "$vin:$keyId:$timestamp"
}

open class TeslaKeyException(message: String) : RuntimeException(message)
class AkamaiChallenge(message: String) : TeslaKeyException(message)
class AuthError(message: String) : TeslaKeyException(message)
class ApiError(val status: Int, val body: String) : TeslaKeyException("HTTP $status: ${body.take(200)}")
class NetworkError(message: String) : TeslaKeyException(message)

@Component
class TeslaKeyClient(builder: RestClient.Builder) {
    companion object {
        const val BATCH_URL = "https://dashcam.tesla.com/api/1/decrypt/batch"
        const val MAX_BATCH = 30
        private const val BROWSER_UA =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    }

    private val rest = builder.build()
    private val mapper = ObjectMapper().registerKotlinModule()

    fun fetchKeys(items: List<KeyItem>, accessToken: String): Map<String, String> {
        if (items.isEmpty()) return emptyMap()
        val out = mutableMapOf<String, String>()
        for (batch in items.chunked(MAX_BATCH)) out.putAll(execute(batch, accessToken))
        return out
    }

    private fun execute(batch: List<KeyItem>, token: String): Map<String, String> {
        val body = mapOf("items" to batch.map { BatchItem(it.id, it.vin, it.keyId, it.timestamp, it.wrappedKey, it.publicKey) })
        val raw: String? = try {
            rest.post()
                .uri(BATCH_URL)
                .header("Authorization", "Bearer $token")
                .header("User-Agent", BROWSER_UA)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(String::class.java)
        } catch (e: RestClientResponseException) {
            when (e.statusCode.value()) {
                403 -> throw AkamaiChallenge("Tesla blocked the key request (Akamai challenge, HTTP 403)")
                401 -> throw AuthError("Tesla rejected the access token (HTTP 401)")
                else -> throw ApiError(e.statusCode.value(), e.responseBodyAsString.take(500))
            }
        } catch (e: Exception) {
            throw NetworkError(e.message ?: "network failure")
        }
        if (raw == null) throw ApiError(200, "empty response body")
        return normalizeResults(raw)
    }

    /** Accepts {"results":[{id,key}]} | [{id,key}] | {"<id>":"<key>"}; drops empty keys. */
    private fun normalizeResults(raw: String): Map<String, String> {
        val root = mapper.readTree(raw)
        val pairs: List<Pair<String, String>> = when {
            root.has("results") && root["results"].isArray ->
                root["results"].map { it.path("id").asText() to it.path("key").asText("") }
            root.isArray ->
                root.map { it.path("id").asText() to it.path("key").asText("") }
            root.isObject ->
                root.fields().asSequence().map { (id, v) -> id to v.asText("") }.toList()
            else -> emptyList()
        }
        return pairs.filter { it.second.isNotBlank() }.toMap()
    }

    private data class BatchItem(
        @JsonProperty("id") val id: String,
        @JsonProperty("vin") val vin: String,
        @JsonProperty("key_id") val keyId: Long,
        @JsonProperty("timestamp") val timestamp: Long,
        @JsonProperty("wrapped_key") val wrappedKey: String,
        @JsonProperty("public_key") val publicKey: String,
    )
}