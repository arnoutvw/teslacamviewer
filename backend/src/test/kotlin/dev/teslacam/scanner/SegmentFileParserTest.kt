package dev.teslacam.scanner

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import java.time.LocalDateTime

class SegmentFileParserTest {
    private val parser = SegmentFileParser()

    @TempDir
    lateinit var tmp: Path

    private fun file(name: String, bytes: Long = 100): Path {
        val p = tmp.resolve(name)
        Files.write(p, ByteArray(bytes.toInt()))
        return p
    }

    @Test
    fun `parses real filename`() {
        val s = parser.parse(file("2026-07-10_17-19-23-back.mp4"))!!
        assertEquals(LocalDateTime.of(2026, 7, 10, 17, 19, 23), s.start)
        assertEquals("back", s.camera)
        assertEquals(100, s.bytes)
    }

    @Test
    fun `parses multiword camera name`() {
        val s = parser.parse(file("2026-05-27_21-03-22-left_repeater.mp4"))!!
        assertEquals("left_repeater", s.camera)
    }

    @Test
    fun `rejects non-segment files`() {
        assertNull(parser.parse(file("event.json")))
        assertNull(parser.parse(file("thumb.png")))
        assertNull(parser.parse(file("notasegment.mp4")))
    }

    @Test
    fun `accepts zero-byte segment`() {
        val s = parser.parse(file("2026-05-27_20-56-21-front.mp4", bytes = 0))!!
        assertEquals(0, s.bytes)
        assertNull(s.durationSeconds)
    }

    // Tesla clips carry moov (containing mvhd) at the end of the file.

    @Test
    fun `reads real duration from trailing mvhd`() {
        val junk = ByteArray(3_500_000) { (it % 251).toByte() } // mdat-first layout
        val p = tmp.resolve("2026-05-27_21-06-23-front.mp4")
        Files.write(p, junk + mp4Tail(version = 0, timescale = 10_000, duration = 452_644))
        assertEquals(45.264, parser.parse(p)!!.durationSeconds!!, 0.001)
    }

    @Test
    fun `reads v1 mvhd duration`() {
        val p = tmp.resolve("2026-07-10_17-19-23-back.mp4")
        val tail = mp4Tail(version = 1, timescale = 1_000, duration = 61_000)
        Files.write(p, byteArrayOf(1, 2, 3) + tail)
        assertEquals(61.0, parser.parse(p)!!.durationSeconds!!, 0.001)
    }

    @Test
    fun `falls back to null duration when no mvhd`() {
        val s = parser.parse(file("2026-05-27_20-56-21-back.mp4", bytes = 1_000))!!
        assertNull(s.durationSeconds)
    }

    @Test
    fun `rejects absurd durations`() {
        val p = tmp.resolve("2026-05-27_20-56-21-front.mp4")
        Files.write(p, mp4Tail(version = 0, timescale = 10_000, duration = 2_600_000_000L)) // 260000s
        assertNull(parser.parse(p)!!.durationSeconds)
    }

    private fun mp4Tail(version: Int, timescale: Int, duration: Long): ByteArray =
        buildList {
            add(0) // moov box size (4 bytes) — parser matches on 'mvhd', size content irrelevant
            repeat(3) { add(0) }
            for (c in "moov") add(c.code.toByte())
            for (c in "mvhd") add(c.code.toByte())
            add(version.toByte()); repeat(3) { add(0) } // version + flags
            if (version == 1) repeat(16) { add(0) } else repeat(8) { add(0) } // creation + modification
            fun u32(v: Long) { add((v ushr 24).toByte()); add((v ushr 16 and 0xFF).toByte()); add((v ushr 8 and 0xFF).toByte()); add((v and 0xFF).toByte()) }
            fun u64(v: Long) { repeat(8) { i -> add((v ushr ((7 - i) * 8) and 0xFF).toByte()) } }
            u32(timescale.toLong())
            if (version == 1) u64(duration) else u32(duration and 0xFFFFFFFFL)
        }.toByteArray()
}
