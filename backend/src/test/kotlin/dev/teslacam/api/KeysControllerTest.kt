// backend/src/test/kotlin/dev/teslacam/api/KeysControllerTest.kt
package dev.teslacam.api

import dev.teslacam.encrypt.*
import io.mockk.Called
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import java.nio.file.Path
import java.util.Base64

/** Standalone MockMvc: real TeslaKeyStore (temp dir), mockk TeslaKeyClient. */
class KeysControllerTest {
    @TempDir
    lateinit var tmp: Path

    private val client = mockk<TeslaKeyClient>()
    private lateinit var store: TeslaKeyStore
    private lateinit var mvc: MockMvc

    private val item = KeyItem(
        id = "SentryClips/2026-07-10_17-21-39/2026-07-10_17-19-23-front.mp4",
        vin = "LRW3E7EK5MC000000",
        keyId = 7,
        timestamp = 1_700_000_000_000,
        wrappedKey = Base64.getEncoder().encodeToString(TestClips.wrappedKeyBlob()),
        publicKey = Base64.getEncoder().encodeToString(TestClips.publicKeyBlob()),
    )
    private val fek = Base64.getEncoder().encodeToString(TestClips.fek())

    @BeforeEach
    fun setup() {
        store = TeslaKeyStore(tmp.toString())
        mvc = MockMvcBuilders
            .standaloneSetup(KeysController(client, store, tmp.toString()))
            .build()
    }

    private fun body(vararg items: KeyItem): String =
        items.joinToString(",", prefix = """{"items":[""", postfix = "]}") {
            """{"id":"${it.id}","vin":"${it.vin}","keyId":${it.keyId},""" +
                """"timestamp":${it.timestamp},"wrappedKey":"${it.wrappedKey}",""" +
                """"publicKey":"${it.publicKey}"}"""
        }

    @Test
    fun `missing Authorization header is 401`() {
        mvc.perform(post("/api/keys/fetch").contentType(MediaType.APPLICATION_JSON).content(body(item)))
            .andExpect(status().isUnauthorized)
            .andExpect(jsonPath("$.error").value("not_logged_in"))
    }

    @Test
    fun `cached item short-circuits without calling Tesla`() {
        store.putAll(mapOf(item.storeKey to fek))
        // Poison stub: any accidental Tesla call yields no keys and the test fails.
        every { client.fetchKeys(any(), any()) } returns emptyMap()
        mvc.perform(
            post("/api/keys/fetch")
                .header("Authorization", "Bearer tok")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body(item)),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.results[0].id").value(item.id))
            .andExpect(jsonPath("$.results[0].status").value("fetched"))
            .andExpect(jsonPath("$.fetched").value(1))
        verify { client wasNot Called }
    }

    @Test
    fun `tesla returns key - fetched and persisted under storeKey`() {
        every { client.fetchKeys(listOf(item), "tok") } returns mapOf(item.id to fek)
        mvc.perform(
            post("/api/keys/fetch")
                .header("Authorization", "Bearer tok")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body(item)),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.results[0].id").value(item.id))
            .andExpect(jsonPath("$.results[0].status").value("fetched"))
            .andExpect(jsonPath("$.fetched").value(1))
        assertNotNull(store.get(item.storeKey))
    }

    @Test
    fun `tesla omits key - no_key and nothing persisted`() {
        every { client.fetchKeys(listOf(item), "tok") } returns emptyMap()
        mvc.perform(
            post("/api/keys/fetch")
                .header("Authorization", "Bearer tok")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body(item)),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.results[0].status").value("no_key"))
            .andExpect(jsonPath("$.fetched").value(0))
        assertNull(store.get(item.storeKey))
    }

    @Test
    fun `akamai challenge - every missing item failed, still 200`() {
        val second = item.copy(id = "SentryClips/2026-07-10_17-21-39/2026-07-10_17-19-23-back.mp4")
        every { client.fetchKeys(any(), any()) } throws AkamaiChallenge("blocked")
        mvc.perform(
            post("/api/keys/fetch")
                .header("Authorization", "Bearer tok")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body(item, second)),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.results[0].id").value(item.id))
            .andExpect(jsonPath("$.results[0].status").value("failed"))
            .andExpect(jsonPath("$.results[1].id").value(second.id))
            .andExpect(jsonPath("$.results[1].status").value("failed"))
            .andExpect(jsonPath("$.fetched").value(0))
    }

    @Test
    fun `status endpoint reports store size`() {
        store.putAll(mapOf(item.storeKey to fek))
        mvc.perform(get("/api/keys"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.keyCount").value(1))
    }
}