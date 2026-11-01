package net.okocraft.spawnseedfinder;

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

/**
 * Posts a message with one attached file to a Discord webhook.
 */
final class DiscordWebhook {

    private static final int MAX_CONTENT = 2000;

    private final URI url;

    DiscordWebhook(String url) {
        this.url = URI.create(url);
    }

    void post(String content, String fileName, String file) throws IOException, InterruptedException {
        if (content.length() > MAX_CONTENT) {
            content = content.substring(0, MAX_CONTENT - 20) + "\n… (see the report)";
        }
        String boundary = "----spawn-seed-finder-" + UUID.randomUUID();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        part(body, boundary, "payload_json", null, "application/json",
            "{\"content\":" + json(content) + ",\"allowed_mentions\":{\"parse\":[]}}");
        part(body, boundary, "files[0]", fileName, "text/markdown", file);
        body.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

        HttpRequest request = HttpRequest.newBuilder(this.url)
            .timeout(Duration.ofSeconds(30))
            .header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
            .build();
        try (HttpClient client = HttpClient.newBuilder().proxy(ProxySelector.getDefault()).build()) {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                // the response body may echo the message (and so the seeds); keep it out of the logs
                throw new IOException("Discord webhook returned HTTP " + response.statusCode());
            }
        }
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

    static String json(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        return out.append('"').toString();
    }
}
