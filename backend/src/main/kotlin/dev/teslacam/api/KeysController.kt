package dev.teslacam.api

import dev.teslacam.encrypt.*
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

data class FetchKeysRequest(val items: List<KeyItem> = emptyList())

@RestController
@RequestMapping("/api/keys")
class KeysController(
    private val keyClient: TeslaKeyClient,
    private val keyStore: TeslaKeyStore,
    @org.springframework.beans.factory.annotation.Value("\${teslacam.root}") private val root: String,
) {
    @GetMapping
    fun status(): Map<String, Int> = mapOf("keyCount" to keyStore.size())

    @PostMapping("/fetch")
    fun fetch(
        @RequestBody body: FetchKeysRequest,
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): ResponseEntity<Any> {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        if (token.isNullOrEmpty()) return ResponseEntity.status(401).body(mapOf("error" to "not_logged_in"))
        val results = mutableListOf<Map<String, String>>()
        var fetched = 0
        val missing = mutableListOf<KeyItem>()
        for (item in body.items) {
            if (keyStore.get(item.storeKey) != null) {
                results += mapOf("id" to item.id, "status" to "fetched"); fetched++
            } else missing += item
        }
        var batchError: String? = null
        // Chunk here (fetchKeys chunks at the same size) so each call is one wire
        // batch; a failed group must not discard keys already persisted from an
        // earlier group.
        for (group in missing.chunked(TeslaKeyClient.MAX_BATCH)) {
            val keys = try {
                keyClient.fetchKeys(group, token)
            } catch (e: AuthError) {
                // Expired token: treat as not logged in so the frontend refreshes/re-logins.
                return ResponseEntity.status(401).body(mapOf("error" to "not_logged_in"))
            } catch (e: TeslaKeyException) {
                batchError = when (e) {
                    is AkamaiChallenge -> "akamai_blocked"
                    is ApiError -> "api_error"
                    else -> "network_error"
                }
                group.forEach { results += mapOf("id" to it.id, "status" to "failed") }
                continue
            }
            // Persist keyed by storeKey so playback can look up without path knowledge.
            val byStoreKey = keys.mapNotNull { (id, fek) ->
                group.find { it.id == id }?.let { it.storeKey to fek }
            }.toMap()
            keyStore.putAll(byStoreKey)
            for (item in group) {
                val status = if (keys.containsKey(item.id)) "fetched" else "no_key"
                if (status == "fetched") fetched++
                results += mapOf("id" to item.id, "status" to status)
            }
        }
        val responseBody = mutableMapOf<String, Any>("results" to results, "fetched" to fetched)
        if (batchError != null) responseBody["error"] = batchError
        return ResponseEntity.ok(responseBody)
    }
}