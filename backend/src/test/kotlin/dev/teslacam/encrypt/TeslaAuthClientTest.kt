package dev.teslacam.encrypt

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.web.client.RestClient
import org.springframework.test.web.client.match.MockRestRequestMatchers.*
import org.springframework.test.web.client.response.MockRestResponseCreators.*

class TeslaAuthClientTest {
    private fun client(): Pair<TeslaAuthClient, MockRestServiceServer> {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        return TeslaAuthClient(builder) to server
    }

    @Test
    fun `exchangeCode posts form grant and maps token response`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaAuthClient.TOKEN_URL))
            .andExpect(method(HttpMethod.POST))
            .andExpect(content().string(
                org.hamcrest.Matchers.containsString("grant_type=authorization_code")))
            .andRespond(withSuccess(
                """{"access_token":"at","refresh_token":"rt","expires_in":3600}""",
                MediaType.APPLICATION_JSON))
        val tokens = client.exchangeCode("the-code", "the-verifier")
        assertEquals("at", tokens.accessToken)
        assertEquals("rt", tokens.refreshToken)
        assertTrue(tokens.expiresAt > System.currentTimeMillis() + 300_000)
    }

    @Test
    fun `refresh reuses old refresh token when response omits one`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaAuthClient.TOKEN_URL))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("grant_type=refresh_token")))
            .andRespond(withSuccess(
                """{"access_token":"at2","expires_in":3600}""", MediaType.APPLICATION_JSON))
        val tokens = client.refresh("old-rt")
        assertEquals("at2", tokens.accessToken)
        assertEquals("old-rt", tokens.refreshToken)
    }

    @Test
    fun `failed exchange maps to AuthError`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaAuthClient.TOKEN_URL))
            .andRespond(withBadRequest().body("""{"error":"invalid_grant"}"""))
        assertThrows(AuthError::class.java) { client.exchangeCode("c", "v") }
    }

    @Test
    fun `mintPkce returns distinct verifiers and s256 challenge`() {
        val (client, _) = client()
        val a = client.mintPkce()
        val b = client.mintPkce()
        assertEquals(43, a.verifier.length) // base64url(32B)
        assertNotEquals(a.verifier, b.verifier)
        val expected = java.util.Base64.getUrlEncoder().withoutPadding()
            .encodeToString(java.security.MessageDigest.getInstance("SHA-256")
                .digest(a.verifier.toByteArray(Charsets.US_ASCII)))
        assertEquals(expected, a.challenge)
    }
}