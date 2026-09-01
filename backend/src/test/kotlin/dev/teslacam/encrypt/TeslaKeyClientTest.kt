package dev.teslacam.encrypt

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpStatusCode
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.web.client.RestClient
import org.springframework.test.web.client.match.MockRestRequestMatchers.*
import org.springframework.test.web.client.response.MockRestResponseCreators.*

class TeslaKeyClientTest {
    private fun client(): Pair<TeslaKeyClient, MockRestServiceServer> {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        return TeslaKeyClient(builder) to server
    }

    private fun item(id: String) = KeyItem(id, "VIN", 7, 1000L, "d3JhcHBlZA==", "cHVi")

    @Test
    fun `results array shape is normalized`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(
            withSuccess("""{"results":[{"id":"a","key":"QUJD"},{"id":"b","key":""}]}""", MediaType.APPLICATION_JSON))
        val out = client.fetchKeys(listOf(item("a"), item("b")), "tok")
        assertEquals(mapOf("a" to "QUJD"), out) // empty key dropped
    }

    @Test
    fun `bare list shape is normalized`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(
            withSuccess("""[{"id":"a","key":"QUJD"}]""", MediaType.APPLICATION_JSON))
        assertEquals(mapOf("a" to "QUJD"), client.fetchKeys(listOf(item("a")), "tok"))
    }

    @Test
    fun `flat map shape is normalized`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(
            withSuccess("""{"a":"QUJD","b":""}""", MediaType.APPLICATION_JSON))
        assertEquals(mapOf("a" to "QUJD"), client.fetchKeys(listOf(item("a"), item("b")), "tok"))
    }

    @Test
    fun `items are batched at 30 per request`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(
            withSuccess("""{"results":[]}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(
            withSuccess("""{"results":[]}""", MediaType.APPLICATION_JSON))
        val items = (0 until 35).map { item("id$it") }
        client.fetchKeys(items, "tok")
        server.verify()
    }

    @Test
    fun `batch request carries snake_case fields and bearer token`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL))
            .andExpect(header("Authorization", "Bearer tok"))
            .andExpect(jsonPath("$.items[0].key_id").value(7))
            .andExpect(jsonPath("$.items[0].wrapped_key").value("d3JhcHBlZA=="))
            .andRespond(withSuccess("""{"results":[{"id":"a","key":"QUJD"}]}""", MediaType.APPLICATION_JSON))
        assertEquals(mapOf("a" to "QUJD"), client.fetchKeys(listOf(item("a")), "tok"))
    }

    @Test
    fun `403 maps to AkamaiChallenge`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(withStatus(HttpStatusCode.valueOf(403)))
        assertThrows(AkamaiChallenge::class.java) { client.fetchKeys(listOf(item("a")), "tok") }
    }

    @Test
    fun `401 maps to AuthError`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(withStatus(HttpStatusCode.valueOf(401)))
        assertThrows(AuthError::class.java) { client.fetchKeys(listOf(item("a")), "tok") }
    }

    @Test
    fun `empty response body maps to ApiError`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(
            withSuccess("", MediaType.APPLICATION_JSON))
        assertThrows(ApiError::class.java) { client.fetchKeys(listOf(item("a")), "tok") }
    }

    @Test
    fun `500 maps to ApiError`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(withServerError())
        assertThrows(ApiError::class.java) { client.fetchKeys(listOf(item("a")), "tok") }
    }
}