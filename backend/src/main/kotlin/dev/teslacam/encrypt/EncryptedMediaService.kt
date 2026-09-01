package dev.teslacam.encrypt

import org.springframework.stereotype.Component
import java.io.OutputStream
import java.io.RandomAccessFile
import java.nio.file.Path
import java.util.Base64

@Component
class EncryptedMediaService(
    private val detector: EncryptionDetector,
    private val keyStore: TeslaKeyStore,
) {
    class MissingKeyException(val storeKey: String) : RuntimeException("no FEK stored for $storeKey")

    fun requireFek(header: EcryptfsHeader): ByteArray {
        val b64 = keyStore.get(header.storeKey)
            ?: throw MissingKeyException(header.storeKey)
        val fek = runCatching { Base64.getDecoder().decode(b64) }.getOrNull()
        if (fek == null || fek.size != 16) throw MissingKeyException(header.storeKey)
        return fek
    }

    /** Writes plaintext bytes [start..endInclusive]; caller clamps end ≤ plaintextSize−1. */
    fun writeRange(
        path: Path, header: EcryptfsHeader, fek: ByteArray,
        start: Long, endInclusive: Long, out: OutputStream,
    ) {
        val dec = PageDecryptor(fek)
        RandomAccessFile(path.toFile(), "r").use { raf ->
            var page = (start / EcryptfsHeaderReader.PAGE_SIZE).toInt()
            var remaining = endInclusive - start + 1
            while (remaining > 0) {
                raf.seek(EcryptfsHeaderReader.HEADER_SIZE + page.toLong() * EcryptfsHeaderReader.PAGE_SIZE)
                val pageBuf = ByteArray(EcryptfsHeaderReader.PAGE_SIZE)
                raf.readFully(pageBuf)
                val pt = dec.decryptPage(pageBuf, page)
                val pageStart = page.toLong() * EcryptfsHeaderReader.PAGE_SIZE
                val from = (start - pageStart).coerceAtLeast(0).toInt()
                val to = (endInclusive - pageStart).coerceAtMost(EcryptfsHeaderReader.PAGE_SIZE - 1L).toInt()
                out.write(pt, from, to - from + 1)
                remaining -= (to - from + 1)
                page++
            }
        }
    }
}