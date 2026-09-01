package dev.teslacam.encrypt

import org.springframework.stereotype.Component
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.FileTime
import java.util.concurrent.ConcurrentHashMap

/**
 * Caches per-file header parses, keyed by path and invalidated when the file's
 * mtime+size change (TeslaCam rotates files; paths get reused).
 */
@Component
class EncryptionDetector {
    private data class Entry(val mtime: FileTime, val size: Long, val header: EcryptfsHeader?)
    private val cache = ConcurrentHashMap<String, Entry>()

    fun headerFor(path: Path): EcryptfsHeader? {
        val mtime = Files.getLastModifiedTime(path)
        val size = Files.size(path)
        val key = path.toAbsolutePath().toString()
        val existing = cache[key]
        if (existing != null && existing.mtime == mtime && existing.size == size) return existing.header
        val header = EcryptfsHeaderReader.read(path)
        cache[key] = Entry(mtime, size, header)
        return header
    }
}