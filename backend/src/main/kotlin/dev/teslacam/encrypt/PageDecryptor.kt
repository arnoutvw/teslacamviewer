package dev.teslacam.encrypt

import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-128-CBC NoPadding page decryption of eCryptfs clips (IV scheme in spec).
 * A fresh Cipher is created per page (Cipher is not thread-safe); one instance
 * per request is fine, and instances may be shared across threads.
 */
class PageDecryptor(fek: ByteArray) {
    private val key = SecretKeySpec(fek, "AES")
    private val rootIv = MessageDigest.getInstance("MD5").digest(fek) // 16 bytes

    fun deriveIv(pageNo: Int): ByteArray {
        val buf = ByteArray(32)
        System.arraycopy(rootIv, 0, buf, 0, 16)
        val digits = pageNo.toString().toByteArray(Charsets.US_ASCII)
        System.arraycopy(digits, 0, buf, 16, digits.size)
        return MessageDigest.getInstance("MD5").digest(buf).copyOf(16)
    }

    /** Decrypts one full 4096-byte ciphertext page. */
    fun decryptPage(page: ByteArray, pageNo: Int): ByteArray {
        require(page.size == EcryptfsHeaderReader.PAGE_SIZE) { "page must be ${EcryptfsHeaderReader.PAGE_SIZE} bytes" }
        val cipher = Cipher.getInstance("AES/CBC/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, IvParameterSpec(deriveIv(pageNo)))
        return cipher.doFinal(page)
    }
}