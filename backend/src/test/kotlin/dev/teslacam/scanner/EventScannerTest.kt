package dev.teslacam.scanner

import dev.teslacam.encrypt.TestClips
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64

class EventScannerTest {
    @TempDir
    lateinit var tmp: Path

    private lateinit var root: Path
    private val cameras = CameraConfig(listOf("front", "back", "left_repeater", "right_repeater", "left_pillar", "right_pillar"))

    @BeforeEach
    fun setup() {
        root = tmp.resolve("dashcam"); Files.createDirectories(root)
    }

    private fun scanner() = EventScanner(root.toString(), cameras, dev.teslacam.encrypt.EncryptionDetector())

    private fun segment(category: String, folder: String, fileName: String, bytes: Long = 100_000) {
        val dir = root.resolve(category).resolve(folder); Files.createDirectories(dir)
        Files.write(dir.resolve(fileName), ByteArray(bytes.coerceAtMost(1_000_000).toInt()))
        if (bytes == 0L) { // make it exactly 0
            Files.write(dir.resolve(fileName), ByteArray(0))
        }
    }

    private fun json(category: String, folder: String, content: String) {
        val dir = root.resolve(category).resolve(folder); Files.createDirectories(dir)
        Files.writeString(dir.resolve("event.json"), content)
    }

    @Test
    fun `scans categories and folders in timestamp order`() {
        segment("SentryClips", "2026-07-10_17-21-39", "2026-07-10_17-19-23-front.mp4")
        segment("SavedClips", "2026-05-27_21-07-35", "2026-05-27_21-02-22-front.mp4")
        val idx = scanner().scan()
        assertEquals(listOf("SavedClips", "SentryClips"), idx.keys.filter { idx[it]!!.isNotEmpty() }.sorted())
        val sentry = idx["SentryClips"]!!
        assertEquals("2026-07-10_17-21-39", sentry[0].folder)
        assertEquals("SentryClips", sentry[0].category)
        assertEquals(1, sentry[0].segmentCount)
        assertTrue(sentry[0].playable)
    }

    @Test
    fun `reads metadata and maps camera index to name`() {
        segment("SentryClips", "2026-07-10_17-21-39", "2026-07-10_17-19-23-front.mp4")
        json("SentryClips", "2026-07-10_17-21-39",
            """{"timestamp":"2026-07-10T17:20:19","city":"Grefrath","street":"Flugplatz",
                "est_lat":"51.3352","est_lon":"6.35791",
                "reason":"sentry_aware_object_detection","camera":"5"}""")
        val e = scanner().scan()["SentryClips"]!![0]
        assertEquals("Grefrath", e.city())
        assertEquals("Flugplatz", e.street())
        assertEquals("right_pillar", e.cameraName)
        assertEquals("sentry_aware_object_detection", e.reason())
    }

    @Test
    fun `event without json is still listed`() {
        segment("SavedClips", "2026-05-27_21-07-35", "2026-05-27_21-02-22-front.mp4")
        val e = scanner().scan()["SavedClips"]!![0]
        assertNull(e.metadata)
        assertNull(e.cameraName)
    }

    @Test
    fun `zero-byte-only event is not playable`() {
        segment("SavedClips", "2026-05-27_20-56-21", "2026-05-27_20-56-21-left_repeater.mp4", 0)
        val e = scanner().scan()["SavedClips"]!![0]
        assertFalse(e.playable)
    }

    @Test
    fun `thumbs are not segments`() {
        segment("SavedClips", "2026-05-27_21-07-35", "2026-05-27_21-02-22-front.mp4")
        val dir = root.resolve("SavedClips").resolve("2026-05-27_21-07-35")
        Files.write(dir.resolve("thumb.png"), ByteArray(10))
        Files.writeString(dir.resolve("event.json"), """{"timestamp":"2026-05-27T21:07:08"}""")
        assertEquals(1, scanner().scan()["SavedClips"]!![0].segmentCount)
    }

    @Test
    fun `missing root yields empty index`() {
        val s = EventScanner(tmp.resolve("does-not-exist").toString(), cameras, dev.teslacam.encrypt.EncryptionDetector())
        assertTrue(s.scan().isEmpty())
    }

    @Test
    fun `detail returns segments grouped by camera with urls`() {
        segment("SentryClips", "2026-07-10_17-21-39", "2026-07-10_17-19-23-front.mp4")
        segment("SentryClips", "2026-07-10_17-21-39", "2026-07-10_17-19-23-back.mp4")
        segment("SentryClips", "2026-07-10_17-21-39", "2026-07-10_17-20-24-front.mp4")
        segment("SentryClips", "2026-07-10_17-21-39", "2026-07-10_17-20-24-left_repeater.mp4", 0)
        val d = scanner().detail("SentryClips", "2026-07-10_17-21-39")!!
        assertEquals(2, d.segmentsByCamera["front"]!!.size)
        assertFalse(d.segmentsByCamera["left_repeater"]!![0].playable)
        assertEquals("/media/SentryClips/2026-07-10_17-21-39/2026-07-10_17-19-23-front.mp4",
            d.segmentsByCamera["front"]!![0].url)
        assertEquals("2026-07-10T17:19:23", d.timeline.start.toString())
        assertTrue(d.timeline.end > d.timeline.start)
    }

    @Test
    fun `detail returns null for unknown folder`() {
        assertNull(scanner().detail("SentryClips", "2020-01-01_00-00-00"))
        assertNull(scanner().detail("HackedClips", "2020-01-01_00-00-00"))
    }

    @Test
    fun `folder without segments is not an event`() {
        val thumbsOnly = root.resolve("SavedClips").resolve("2019-01-01_00-00-00")
        Files.createDirectories(thumbsOnly)
        Files.write(thumbsOnly.resolve("thumb.png"), ByteArray(10))
        Files.writeString(thumbsOnly.resolve("event.json"), """{"timestamp":"2019-01-01T00:00:00"}""")
        segment("SavedClips", "2026-05-27_21-07-35", "2026-05-27_21-02-22-front.mp4")

        val saved = scanner().scan()["SavedClips"]!!

        assertEquals(1, saved.size)
        assertEquals("2026-05-27_21-07-35", saved[0].folder)
    }

    @Test
    fun `corrupt event json yields null metadata`() {
        segment("SavedClips", "2026-05-27_21-07-35", "2026-05-27_21-02-22-front.mp4")
        json("SavedClips", "2026-05-27_21-07-35", "not json at all {{{")
        val e = scanner().scan()["SavedClips"]!![0]
        assertNull(e.metadata)
        assertEquals("2026-05-27_21-07-35", e.folder)
        assertEquals(1, e.segmentCount)
    }

    @Test
    fun `partial event json with only reason and camera keeps metadata`() {
        segment("SentryClips", "2026-07-10_17-21-39", "2026-07-10_17-19-23-front.mp4")
        json("SentryClips", "2026-07-10_17-21-39",
            """{"reason":"sentry_aware_object_detection","camera":"5"}""")
        val e = scanner().scan()["SentryClips"]!![0]
        assertNotNull(e.metadata)
        assertEquals(5, e.metadata?.cameraIndex)
        assertNull(e.metadata?.timestamp)
        assertNull(e.metadata?.city)
    }

    @Test
    fun `camera index outside order yields null camera name`() {
        segment("SentryClips", "2026-07-10_17-21-39", "2026-07-10_17-19-23-front.mp4")
        json("SentryClips", "2026-07-10_17-21-39",
            """{"timestamp":"2026-07-10T17:20:19","camera":"9"}""")
        val e = scanner().scan()["SentryClips"]!![0]
        assertNotNull(e.metadata)
        assertNull(e.cameraName)
    }

    private fun EventSummary.city() = metadata?.city
    private fun EventSummary.street() = metadata?.street
    private fun EventSummary.reason() = metadata?.reason

    // --- Task 7: encrypted flags + key items ---

    @Test
    fun `plain clips report encrypted false and null keyItem`() {
        segment("SentryClips", "2026-07-10_17-21-39", "2026-07-10_17-19-23-front.mp4")
        val d = scanner().detail("SentryClips", "2026-07-10_17-21-39")!!
        assertFalse(d.summary.encrypted)
        val seg = d.segmentsByCamera["front"]!![0]
        assertFalse(seg.encrypted)
        assertNull(seg.keyItem)
    }

    @Test
    fun `encrypted clip exposes keyItem with root-relative id`() {
        val dir = root.resolve("SentryClips").resolve("2026-07-10_17-21-39")
        Files.createDirectories(dir)
        TestClips.buildEncrypted(dir, "2026-07-10_17-19-23-front.mp4", ByteArray(4096))
        val d = scanner().detail("SentryClips", "2026-07-10_17-21-39")!!
        assertTrue(d.summary.encrypted)
        val seg = d.segmentsByCamera["front"]!![0]
        assertTrue(seg.encrypted)
        val key = seg.keyItem!!
        assertEquals("SentryClips/2026-07-10_17-21-39/2026-07-10_17-19-23-front.mp4", key.id)
        assertEquals("LRW3E7EK5MC000000", key.vin)
        assertEquals(7L, key.keyId)
        assertEquals(1_700_000_000_000, key.timestamp)
        assertEquals(Base64.getEncoder().encodeToString(TestClips.wrappedKeyBlob()), key.wrappedKey)
        assertEquals(Base64.getEncoder().encodeToString(TestClips.publicKeyBlob()), key.publicKey)
        assertEquals("LRW3E7EK5MC000000:7:1700000000000", key.storeKey)
    }

    @Test
    fun `encrypted segment seconds estimated from size not mvhd`() {
        val dir = root.resolve("SentryClips").resolve("2026-07-10_17-21-39")
        Files.createDirectories(dir)
        // 3_000_000 plaintext bytes -> 733 pages -> file = 8192 + 3002368 bytes.
        TestClips.buildEncrypted(dir, "2026-07-10_17-19-23-front.mp4", ByteArray(3_000_000))
        val seg = scanner().detail("SentryClips", "2026-07-10_17-21-39")!!.segmentsByCamera["front"]!![0]
        assertEquals(3002368.0 / 1_400_000.0, seg.estimatedSeconds, 1e-9)
    }

    @Test
    fun `summary encrypted when any segment is encrypted`() {
        segment("SentryClips", "2026-07-10_17-21-39", "2026-07-10_17-19-23-front.mp4")
        val dir = root.resolve("SentryClips").resolve("2026-07-10_17-21-39")
        TestClips.buildEncrypted(dir, "2026-07-10_17-19-23-back.mp4", ByteArray(4096))
        assertTrue(scanner().scan()["SentryClips"]!![0].encrypted)
    }
}
