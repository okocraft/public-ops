package net.okocraft.spawnseedfinder;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Posts a message with one attached file to a Discord webhook.
 *
 * <p>Threads: to post into an existing thread, add {@code ?thread_id=...} to the webhook URL. A webhook of a
 * forum/media channel needs a thread, so when Discord answers that one is required (error 220001) and the URL has
 * no thread id, the message is posted again as a new forum post named {@code forumPostName}.</p>
 */
final class DiscordWebhook {

    /** "Webhooks posted to forum channels must have a thread_name or thread_id". */
    private static final int FORUM_NEEDS_THREAD = 220001;
    private static final Pattern ERROR_CODE = Pattern.compile("\"code\"\\s*:\\s*(\\d+)");
    private static final Pattern ERROR_MESSAGE = Pattern.compile("\"message\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");

    static final int MAX_ATTEMPTS = 5;
    private static final Duration MAX_WAIT = Duration.ofMinutes(2);
    private static final Pattern RETRY_AFTER = Pattern.compile("\"retry_after\"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)");

    interface Sleeper {
        void sleep(Duration duration) throws InterruptedException;
    }

    private final URI url;
    private final boolean hasThread;
    Sleeper sleeper = duration -> Thread.sleep(duration);
    private final String forumPostName;

    /**
     * @param url           webhook URL, optionally with {@code ?thread_id=...} to post into an existing thread
     * @param forumPostName name of the forum post to create when the webhook belongs to a forum channel
     */
    DiscordWebhook(String url, String forumPostName) {
        this.url = URI.create(url.trim());
        this.hasThread = this.url.getRawQuery() != null && this.url.getRawQuery().contains("thread_id=");
        this.forumPostName = forumPostName;
    }

    /**
     * @param message message object ({@code content}, {@code embeds}, ...); the attachment is added as {@code files[0]}
     */
    void post(JsonObject message, String fileName, String file) throws IOException, InterruptedException {
        HttpResponse<String> response = this.sendWithRetry(message, null, fileName, file);
        if (response.statusCode() == 400 && errorCode(response.body()) == FORUM_NEEDS_THREAD && !this.hasThread && this.forumPostName != null) {
            response = this.sendWithRetry(message, this.forumPostName, fileName, file);
        }
        if (response.statusCode() / 100 != 2) {
            // Only Discord's error code and message are logged; the rest of the body may echo the posted content.
            throw new IOException("Discord webhook returned HTTP " + response.statusCode() + errorDescription(response.body()));
        }
    }

    /**
     * Retries on 429 (waiting as long as Discord asks: {@code Retry-After} header or {@code retry_after} in the
     * body) and on 5xx / connection errors (exponential backoff).
     */
    private HttpResponse<String> sendWithRetry(JsonObject message, String threadName, String fileName, String file) throws IOException, InterruptedException {
        for (int attempt = 1; ; attempt++) {
            HttpResponse<String> response;
            try {
                response = this.send(message, threadName, fileName, file);
            } catch (IOException e) {
                if (attempt >= MAX_ATTEMPTS) {
                    throw e;
                }
                this.sleeper.sleep(backoff(attempt));
                continue;
            }
            int status = response.statusCode();
            boolean retryable = status == 429 || status >= 500;
            if (!retryable || attempt >= MAX_ATTEMPTS) {
                return response;
            }
            Duration wait = status == 429 ? retryAfter(response) : backoff(attempt);
            this.sleeper.sleep(wait.compareTo(MAX_WAIT) > 0 ? MAX_WAIT : wait);
        }
    }

    static Duration backoff(int attempt) {
        return Duration.ofSeconds(1L << Math.min(attempt, 5)); // 2, 4, 8, 16, 32 s
    }

    static Duration retryAfter(HttpResponse<String> response) {
        Matcher matcher = RETRY_AFTER.matcher(response.body() == null ? "" : response.body());
        double seconds = -1;
        if (matcher.find()) {
            seconds = Double.parseDouble(matcher.group(1));
        } else {
            seconds = response.headers().firstValue("Retry-After").map(value -> {
                try {
                    return Double.parseDouble(value.trim());
                } catch (NumberFormatException e) {
                    return -1.0;
                }
            }).orElse(-1.0);
        }
        if (seconds < 0) {
            return Duration.ofSeconds(5);
        }
        return Duration.ofMillis((long) Math.ceil(seconds * 1000) + 250); // small margin over the bucket reset
    }

    private HttpResponse<String> send(JsonObject message, String threadName, String fileName, String file) throws IOException, InterruptedException {
        JsonObject payload = message.deepCopy();
        if (threadName != null) {
            payload.addProperty("thread_name", threadName.length() > 100 ? threadName.substring(0, 100) : threadName);
        }
        JsonObject allowedMentions = new JsonObject();
        allowedMentions.add("parse", new JsonArray());
        payload.add("allowed_mentions", allowedMentions);

        String boundary = "----spawn-seed-finder-" + UUID.randomUUID();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        part(body, boundary, "payload_json", null, "application/json", payload.toString());
        part(body, boundary, "files[0]", fileName, "text/markdown", file);
        body.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

        HttpRequest request = HttpRequest.newBuilder(this.url)
            .timeout(Duration.ofSeconds(30))
            .header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
            .build();
        try (HttpClient client = HttpClient.newBuilder().proxy(ProxySelector.getDefault()).build()) {
            return client.send(request, HttpResponse.BodyHandlers.ofString());
        }
    }

    static int errorCode(String body) {
        Matcher matcher = ERROR_CODE.matcher(body == null ? "" : body);
        return matcher.find() ? Integer.parseInt(matcher.group(1)) : -1;
    }

    static String errorDescription(String body) {
        int code = errorCode(body);
        Matcher matcher = ERROR_MESSAGE.matcher(body == null ? "" : body);
        String message = matcher.find() ? matcher.group(1) : null;
        if (code < 0 && message == null) {
            return "";
        }
        StringBuilder out = new StringBuilder(" (");
        if (code >= 0) {
            out.append("code ").append(code);
        }
        if (message != null) {
            out.append(code >= 0 ? ": " : "").append(message.length() > 200 ? message.substring(0, 200) : message);
        }
        if (code == FORUM_NEEDS_THREAD) {
            out.append("; add ?thread_id=... to the webhook URL, or set a forum post name");
        }
        return out.append(')').toString();
    }

    private static void part(ByteArrayOutputStream body, String boundary, String name, String fileName, String type, String value) throws IOException {
        StringBuilder header = new StringBuilder()
            .append("--").append(boundary).append("\r\n")
            .append("Content-Disposition: form-data; name=\"").append(name).append('"');
        if (fileName != null) {
            header.append("; filename=\"").append(fileName).append('"');
        }
        header.append("\r\nContent-Type: ").append(type).append("\r\n\r\n");
        body.write(header.toString().getBytes(StandardCharsets.UTF_8));
        body.write(value.getBytes(StandardCharsets.UTF_8));
        body.write("\r\n".getBytes(StandardCharsets.UTF_8));
    }
}
