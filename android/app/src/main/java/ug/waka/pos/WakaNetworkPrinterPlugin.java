package ug.waka.pos;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Local LAN ESC/POS TCP transport for Android (port 9100 class printers).
 * Private IPv4 only — no cloud print, no public internet destinations.
 */
@CapacitorPlugin(name = "WakaNetworkPrinter")
public class WakaNetworkPrinterPlugin extends Plugin {

  private static final int DEFAULT_PORT = 9100;
  private static final int CONNECT_TIMEOUT_MS = 5000;
  private static final int WRITE_TIMEOUT_MS = 10000;
  private static final int CHUNK = 1024;
  private static final int MAX_PAYLOAD = 256 * 1024;

  private final ExecutorService io = Executors.newCachedThreadPool();

  @Override
  protected void handleOnDestroy() {
    io.shutdownNow();
    super.handleOnDestroy();
  }

  @PluginMethod
  public void getTransportState(PluginCall call) {
    JSObject r = new JSObject();
    r.put("nativeTransport", true);
    call.resolve(r);
  }

  @PluginMethod
  public void testConnection(PluginCall call) {
    io.execute(() -> {
      try {
        Destination dest = destination(call, false);
        try (Socket socket = connect(dest)) {
          JSObject r = new JSObject();
          r.put("ok", true);
          r.put("message", "Printer connected");
          r.put("status", "reachable");
          call.resolve(r);
        }
      } catch (PluginReject e) {
        call.reject(e.userMessage, e.code);
      } catch (Exception e) {
        call.reject("Could not connect to printer", "connection_failed");
      }
    });
  }

  @PluginMethod
  public void printEscPos(PluginCall call) {
    io.execute(() -> {
      try {
        Destination dest = destination(call, true);
        try (Socket socket = connect(dest)) {
          socket.setSoTimeout(WRITE_TIMEOUT_MS);
          OutputStream out = socket.getOutputStream();
          int offset = 0;
          while (offset < dest.data.length) {
            int n = Math.min(CHUNK, dest.data.length - offset);
            out.write(dest.data, offset, n);
            out.flush();
            offset += n;
          }
          JSObject r = new JSObject();
          r.put("ok", true);
          r.put("status", "printed");
          r.put("bytesWritten", dest.data.length);
          call.resolve(r);
        }
      } catch (PluginReject e) {
        call.reject(e.userMessage, e.code);
      } catch (Exception e) {
        call.reject("Could not connect to printer", "connection_failed");
      }
    });
  }

  private Socket connect(Destination dest) throws Exception {
    Socket socket = new Socket();
    socket.connect(new InetSocketAddress(dest.host, dest.port), CONNECT_TIMEOUT_MS);
    return socket;
  }

  private Destination destination(PluginCall call, boolean requireData) throws PluginReject {
    String host = call.getString("host");
    Integer portObj = call.getData() != null ? call.getData().optInt("port", DEFAULT_PORT) : DEFAULT_PORT;
    int port = portObj != null ? portObj : DEFAULT_PORT;
    String validHost = validatePrivateIpv4(host);
    if (port < 1 || port > 65535) {
      throw new PluginReject("invalid_port", "Could not connect to printer");
    }
    byte[] data = requireData ? readBytes(call) : new byte[0];
    if (requireData && (data == null || data.length == 0)) {
      throw new PluginReject("empty_payload", "Nothing to print.");
    }
    if (data != null && data.length > MAX_PAYLOAD) {
      throw new PluginReject("payload_too_large", "Could not connect to printer");
    }
    return new Destination(validHost, port, data == null ? new byte[0] : data);
  }

  private byte[] readBytes(PluginCall call) {
    JSArray arr = call.getArray("data");
    if (arr == null) return null;
    try {
      int n = arr.length();
      byte[] out = new byte[n];
      for (int i = 0; i < n; i++) {
        out[i] = (byte) (arr.getInt(i) & 0xff);
      }
      return out;
    } catch (Exception e) {
      return null;
    }
  }

  static String validatePrivateIpv4(String host) throws PluginReject {
    String trimmed = host == null ? "" : host.trim().toLowerCase();
    if (trimmed.isEmpty() || trimmed.equals("localhost") || trimmed.equals("::1") || trimmed.equals("0.0.0.0")) {
      throw new PluginReject("invalid_host", "Could not connect to printer");
    }
    if (trimmed.contains(":") || trimmed.contains("/") || trimmed.contains("://")) {
      throw new PluginReject("invalid_host", "Could not connect to printer");
    }
    String[] parts = trimmed.split("\\.");
    if (parts.length != 4) {
      throw new PluginReject("invalid_host", "Could not connect to printer");
    }
    int[] n = new int[4];
    for (int i = 0; i < 4; i++) {
      if (!parts[i].matches("\\d{1,3}") || (parts[i].length() > 1 && parts[i].startsWith("0"))) {
        throw new PluginReject("invalid_host", "Could not connect to printer");
      }
      n[i] = Integer.parseInt(parts[i]);
      if (n[i] < 0 || n[i] > 255) {
        throw new PluginReject("invalid_host", "Could not connect to printer");
      }
    }
    if (n[0] == 127 || n[0] == 0 || n[0] >= 224) {
      throw new PluginReject("invalid_host", "Could not connect to printer");
    }
    boolean priv = n[0] == 10
      || (n[0] == 192 && n[1] == 168)
      || (n[0] == 172 && n[1] >= 16 && n[1] <= 31)
      || (n[0] == 169 && n[1] == 254);
    if (!priv) {
      throw new PluginReject("public_host_rejected", "Could not connect to printer");
    }
    return n[0] + "." + n[1] + "." + n[2] + "." + n[3];
  }

  static final class Destination {
    final String host;
    final int port;
    final byte[] data;

    Destination(String host, int port, byte[] data) {
      this.host = host;
      this.port = port;
      this.data = data;
    }
  }

  static final class PluginReject extends Exception {
    final String code;
    final String userMessage;

    PluginReject(String code, String userMessage) {
      super(userMessage);
      this.code = code;
      this.userMessage = userMessage;
    }
  }
}
