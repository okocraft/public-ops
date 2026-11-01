package net.okocraft.spawnseedfinder;

import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DiscordWebhookTest {

    @Test
    void describesErrorsWithoutTheBody() {
        String body = "{\"message\": \"Webhooks posted to forum channels must have a thread_name or thread_id\", \"code\": 220001}";
        assertEquals(220001, DiscordWebhook.errorCode(body));
        assertEquals(" (code 220001: Webhooks posted to forum channels must have a thread_name or thread_id; add ?thread_id=... to the webhook URL, or set a forum post name)",
            DiscordWebhook.errorDescription(body));
        assertEquals(" (code 50035: Invalid Form Body)",
            DiscordWebhook.errorDescription("{\"code\": 50035, \"errors\": {\"content\": {\"_errors\": []}}, \"message\": \"Invalid Form Body\"}"));
        assertEquals("", DiscordWebhook.errorDescription("<html>bad gateway</html>"));
    }

    @Test
    void retriesRateLimitedRequests() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        HttpServer server = server(exchange -> {
            int n = requests.incrementAndGet();
            if (n == 1) {
                respond(exchange, 429, "{\"message\": \"You are being rate limited.\", \"retry_after\": 0.5, \"global\": false}");
            } else if (n == 2) {
                exchange.getResponseHeaders().add("Retry-After", "2");
                respond(exchange, 429, "");
            } else if (n == 3) {
                respond(exchange, 502, "");
            } else {
                respond(exchange, 200, "{}");
            }
        });
        try {
            List<Duration> waits = new ArrayList<>();
            DiscordWebhook webhook = new DiscordWebhook("http://127.0.0.1:" + server.getAddress().getPort() + "/api/webhooks/1/token", null);
            webhook.sleeper = waits::add;
            webhook.post(message(), "report.md", "# report");
            assertEquals(4, requests.get());
            assertEquals(List.of(Duration.ofMillis(750), Duration.ofMillis(2250), Duration.ofSeconds(8)), waits);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void givesUpAfterMaxAttempts() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        HttpServer server = server(exchange -> {
            requests.incrementAndGet();
            respond(exchange, 429, "{\"retry_after\": 1, \"message\": \"You are being rate limited.\", \"code\": 0}");
        });
        try {
            DiscordWebhook webhook = new DiscordWebhook("http://127.0.0.1:" + server.getAddress().getPort() + "/api/webhooks/1/token", null);
            webhook.sleeper = duration -> {};
            IOException e = assertThrows(IOException.class, () -> webhook.post(message(), "report.md", "# report"));
            assertEquals(DiscordWebhook.MAX_ATTEMPTS, requests.get());
            assertTrue(e.getMessage().contains("HTTP 429"), e.getMessage());
        } finally {
            server.stop(0);
        }
    }

    private static JsonObject message() {
        JsonObject message = new JsonObject();
        message.addProperty("content", "hello");
        return message;
    }

    private interface Handler {
        void handle(com.sun.net.httpserver.HttpExchange exchange) throws IOException;
    }

    private static HttpServer server(Handler handler) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.getRequestBody().readAllBytes();
            handler.handle(exchange);
        });
        server.start();
        return server;
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
        if (bytes.length > 0) {
            exchange.getResponseBody().write(bytes);
        }
        exchange.close();
    }
}
