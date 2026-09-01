package dev.teslacam.api

import dev.teslacam.encrypt.*
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/tesla")
class TeslaAuthController(private val auth: TeslaAuthClient) {

    @GetMapping("/pkce")
    fun pkce(): PkceChallenge = auth.mintPkce()

    @PostMapping("/token")
    fun token(@RequestBody body: Map<String, String>): ResponseEntity<Any> {
        val code = body["code"] ?: return badRequest()
        val verifier = body["verifier"] ?: return badRequest()
        return try {
            ResponseEntity.ok(auth.exchangeCode(code, verifier))
        } catch (_: AuthError) {
            ResponseEntity.status(401).body(mapOf("error" to "token_exchange_failed"))
        }
    }

    @PostMapping("/refresh")
    fun refresh(@RequestBody body: Map<String, String>): ResponseEntity<Any> {
        val rt = body["refreshToken"] ?: return badRequest()
        return try {
            ResponseEntity.ok(auth.refresh(rt))
        } catch (_: AuthError) {
            ResponseEntity.status(401).body(mapOf("error" to "refresh_failed"))
        }
    }

    private fun badRequest(): ResponseEntity<Any> = ResponseEntity.badRequest().body(mapOf("error" to "missing_parameter"))
}