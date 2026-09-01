package dev.teslacam.encrypt

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

class TeslaKeyStoreTest {
    @TempDir lateinit var dir: Path

    @Test
    fun `persists across instances`() {
        TeslaKeyStore(dir.toString()).putAll(mapOf("VIN:1:2" to "AAAA"))
        assertEquals("AAAA", TeslaKeyStore(dir.toString()).get("VIN:1:2"))
    }

    @Test
    fun `missing file behaves as empty`() {
        assertEquals(0, TeslaKeyStore(dir.toString()).size())
        assertNull(TeslaKeyStore(dir.toString()).get("VIN:1:2"))
    }

    @Test
    fun `putAll is idempotent and counts only new keys`() {
        val store = TeslaKeyStore(dir.toString())
        assertEquals(1, store.putAll(mapOf("VIN:1:2" to "AAAA")))
        assertEquals(0, store.putAll(mapOf("VIN:1:2" to "BBBB"))) // putIfAbsent: no overwrite
        assertEquals("AAAA", store.get("VIN:1:2"))
    }

    @Test
    fun `corrupt file does not crash load`() {
        java.nio.file.Files.writeString(dir.resolve(".teslacam_keys.json"), "{not json")
        assertEquals(0, TeslaKeyStore(dir.toString()).size())
    }

    @Test
    fun `custom keystore path is honored`() {
        val custom = dir.resolve("config").resolve("keys.json")
        java.nio.file.Files.createDirectories(custom.parent)
        val store = TeslaKeyStore(dir.toString(), custom.toString())
        assertEquals(1, store.putAll(mapOf("VIN:1:2" to "AAAA")))
        // Persisted at the configured path, not at the default next to the root
        assertTrue(java.nio.file.Files.isRegularFile(custom))
        assertFalse(java.nio.file.Files.exists(dir.resolve(".teslacam_keys.json")))
        assertEquals("AAAA", TeslaKeyStore(dir.toString(), custom.toString()).get("VIN:1:2"))
    }

    @Test
    fun `empty keystore path falls back to default file`() {
        val store = TeslaKeyStore(dir.toString(), "")
        assertEquals(1, store.putAll(mapOf("VIN:1:2" to "AAAA")))
        assertTrue(java.nio.file.Files.isRegularFile(dir.resolve(".teslacam_keys.json")))
        assertEquals("AAAA", TeslaKeyStore(dir.toString(), "").get("VIN:1:2"))
    }

    @Test
    fun `remove drops the entry and persists`() {
        val store = TeslaKeyStore(dir.toString())
        store.putAll(mapOf("VIN:1:2" to "AAAA"))
        assertTrue(store.remove("VIN:1:2"))
        assertFalse(store.remove("VIN:1:2"))
        assertNull(store.get("VIN:1:2"))
        assertEquals(0, TeslaKeyStore(dir.toString()).size())
    }
}