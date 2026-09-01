package dev.teslacam.encrypt

import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.util.LinkedMultiValueMap
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientResponseException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

data class TeslaTokens(val accessToken: String, val refreshToken: String, val expiresAt: Long)
data class PkceChallenge(val verifier: String, val challenge: String, val state: String)

@Component
class TeslaAuthClient(private val builder: RestClient.Builder) {
    companion object {
        const val TOKEN_URL = "https://auth.tesla.com/oauth2/v3/token"
        const val REDIRECT_URI = "https://dashcam.tesla.com/callback"
        const val CLIENT_ID = "dashcam"
        private val random = SecureRandom()
    }

    private val rest by lazy { builder.build() }
    private val mapper = com.fasterxml.jackson.databind.ObjectMapper()
        .registerModule(com.fasterxml.jackson.module.kotlin.KotlinModule.Builder().build())

    fun mintPkce(): PkceChallenge {
        val verifierBytes = ByteArray(32); random.nextBytes(verifierBytes)
        val verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(verifierBytes)
        val challenge = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
        val stateBytes = ByteArray(16); random.nextBytes(stateBytes)
        val state = java.lang.Long.toHexString(random.nextLong()) + java.lang.Long.toHexString(random.nextLong())
        return PkceChallenge(verifier, challenge, state)
    }

    fun exchangeCode(code: String, verifier: String): TeslaTokens =
        token(mapOf(
            "grant_type" to "authorization_code",
            "client_id" to CLIENT_ID,
            "code" to code,
            "redirect_uri" to REDIRECT_URI,
            "code_verifier" to verifier,
        ))

    fun refresh(refreshToken: String): TeslaTokens {
        val tokens = token(mapOf(
            "grant_type" to "refresh_token",
            "client_id" to CLIENT_ID,
            "refresh_token" to refreshToken,
        ))
        return if (tokens.refreshToken.isBlank()) tokens.copy(refreshToken = refreshToken) else tokens
    }

    private fun token(form: Map<String, String>): TeslaTokens {
        val entity = LinkedMultiValueMap<String, String>().apply { form.forEach { (k, v) -> add(k, v) } }
        val raw = try {
            rest.post()
                .uri(TOKEN_URL)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(entity)
                .retrieve()
                .body(String::class.java)
                ?: throw AuthError("empty token response")
        } catch (e: RestClientResponseException) {
            throw AuthError("token endpoint HTTP ${e.statusCode.value()}: ${e.responseBodyAsString.take(200)}")
        }
        val tree = mapper.readTree(raw)
        val access = tree.path("access_token").asText("")
        if (access.isBlank()) throw AuthError("token response missing access_token")
        val expiresIn = tree.path("expires_in").asLong(3600)
        return TeslaTokens(
            accessToken = access,
            refreshToken = tree.path("refresh_token").asText(""),
            expiresAt = System.currentTimeMillis() + (expiresIn - 60) * 1000,
        )
    }
}