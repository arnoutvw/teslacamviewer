package dev.teslacam

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.context.WebApplicationContext

@SpringBootTest
class CorsTest(@Autowired val ctx: WebApplicationContext) {
    @Test
    fun `preflight from vite dev origin allowed`() {
        val mvc = MockMvcBuilders.webAppContextSetup(ctx).build()
        mvc.perform(options("/api/events/SentryClips")
                .header("Origin", "http://localhost:5173")
                .header("Access-Control-Request-Method", "GET"))
            .andExpect(status().isOk)
            .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"))
    }

    @Test
    fun `preflight allows Authorization and Content-Type headers`() {
        val mvc = MockMvcBuilders.webAppContextSetup(ctx).build()
        mvc.perform(options("/api/keys/fetch")
                .header("Origin", "http://localhost:5173")
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "Authorization, Content-Type"))
            .andExpect(status().isOk)
    }

    @Test
    fun `preflight rejects headers outside the allow-list`() {
        val mvc = MockMvcBuilders.webAppContextSetup(ctx).build()
        mvc.perform(options("/api/keys/fetch")
                .header("Origin", "http://localhost:5173")
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "X-Custom-Header"))
            .andExpect(status().isForbidden)
    }
}
