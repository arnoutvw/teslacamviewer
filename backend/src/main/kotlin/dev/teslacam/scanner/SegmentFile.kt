package dev.teslacam.scanner

import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.Path
import java.time.LocalDateTime

data class SegmentFile(
    val start: LocalDateTime,
    val camera: String,
    val file: Path,
    val bytes: Long,
    /** Real MP4 duration from the mvhd box; null when it cannot be parsed. */
    val durationSeconds: Double?,
) {
    constructor(start: LocalDateTime, camera: String, file: Path, bytes: Long) :
        this(start, camera, file, bytes, null)
}

class SegmentFileParser {
    private val pattern =
        Regex("""^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-([a-z_]+)\.mp4$""")

    fun parse(file: Path): SegmentFile? {
        val m = pattern.matchEntire(file.fileName.toString()) ?: return null
        val g = m.groupValues
        val start = LocalDateTime.of(
            g[1].toInt(), g[2].toInt(), g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt(),
        )
        return SegmentFile(start, g[7], file, Files.size(file), readDurationSeconds(file))
    }

    private fun readDurationSeconds(file: Path): Double? = runCatching {
        RandomAccessFile(file.toFile(), "r").use { raf ->
            val tail = ByteArray(minOf(raf.length().toInt(), TAIL_BYTES))
            raf.seek(raf.length() - tail.size)
            raf.readFully(tail)
            val idx = tail.lastIndexOfRange("mvhd".toByteArray(Charsets.US_ASCII)) // moov is the final box: last mvhd wins
            if (idx < 0) return@use null
            val version = tail[idx + 4].toInt()
            val (tsOff, dur) = if (version == 1) {
                idx + 24 to readLong(tail, idx + 28)
            } else {
                idx + 16 to readInt(tail, idx + 20).toLong()
            }
            val timescale = readInt(tail, tsOff)
            if (timescale <= 0) return@use null
            val seconds = dur / timescale.toDouble()
            if (seconds in MIN_DURATION_SECONDS..MAX_DURATION_SECONDS) seconds else null
        }
    }.getOrNull()

    companion object {
        // Tesla clips write mdat first and the moov box at the end of the file,
        // so the real duration lives in the mvhd box near the tail. A clip is
        // at most a couple of minutes; bound the sanity range accordingly.
        private const val TAIL_BYTES = 4 shl 20
        private const val MIN_DURATION_SECONDS = 0.05
        private const val MAX_DURATION_SECONDS = 7200.0

        private fun readInt(b: ByteArray, off: Int): Int =
            (b[off].toInt() and 0xFF shl 24) or (b[off + 1].toInt() and 0xFF shl 16) or
                (b[off + 2].toInt() and 0xFF shl 8) or (b[off + 3].toInt() and 0xFF)

        private fun readLong(b: ByteArray, off: Int): Long {
            var v = 0L
            for (i in 0 until 8) v = (v shl 8) or (b[off + i].toLong() and 0xFF)
            return v
        }

        private fun ByteArray.lastIndexOfRange(needle: ByteArray): Int {
            outer@ for (i in size - needle.size downTo 0) {
                for (j in needle.indices) if (this[i + j] != needle[j]) continue@outer
                return i
            }
            return -1
        }
    }
}