package ug.waka.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Log;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Local-only Bluetooth printer transport (Classic SPP/RFCOMM + BLE GATT writes).
 * Does not upload device lists or receipt bytes.
 */
@CapacitorPlugin(name = "WakaBluetoothPrinter")
public class WakaBluetoothPrinterPlugin extends Plugin {

  static final String TAG = "WAKA_BT";
  static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
  static final UUID BLE_SVC_FFE0 = uuidFromShort(0xffe0);
  static final UUID BLE_CHR_FFE1 = uuidFromShort(0xffe1);
  static final UUID BLE_SVC_18F0 = uuidFromShort(0x18f0);
  static final UUID BLE_CHR_2AF1 = uuidFromShort(0x2af1);
  static final byte[] CLASSIC_DIAGNOSTIC_BYTES = new byte[] {
    0x1b, 0x40,
    'W', 'A', 'K', 'A', ' ', 'T', 'E', 'S', 'T',
    0x0a, 0x0a
  };

  private static final int SCAN_DEFAULT_MS = 12000;
  private static final int CONNECT_TIMEOUT_MS = 8000;
  private static final int CLASSIC_ATTEMPT_TIMEOUT_MS = 3000;
  private static final int CLASSIC_CHUNK = 512;
  private static final long CLASSIC_CHUNK_PAUSE_MS = 8L;
  private static final long CLASSIC_SETTLE_AFTER_CONNECT_MS = 150L;
  private static final long CLASSIC_SETTLE_AFTER_FLUSH_MS = 250L;
  private static final long CLASSIC_WRITE_RETRY_SETTLE_MS = 300L;

  private final ExecutorService io = Executors.newCachedThreadPool();
  private final Handler main = new Handler(Looper.getMainLooper());
  private final Map<String, ClassicSession> classicSessions = new ConcurrentHashMap<>();
  private final Map<String, BleSession> bleSessions = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, Object> classicLocks = new ConcurrentHashMap<>();
  private final Map<String, JSObject> scanHits = new LinkedHashMap<>();

  private final AtomicBoolean scanning = new AtomicBoolean(false);
  private PluginCall pendingScanCall;
  private BroadcastReceiver discoveryReceiver;
  private ScanCallback leScanCallback;
  private Runnable scanTimeout;

  private static UUID uuidFromShort(int shortUuid) {
    return UUID.fromString(String.format(Locale.US, "0000%04x-0000-1000-8000-00805f9b34fb", shortUuid & 0xffff));
  }

  @Override
  protected void handleOnPause() {
    stopScanInternal();
    super.handleOnPause();
  }

  @Override
  protected void handleOnDestroy() {
    stopScanInternal();
    closeAllSessions();
    io.shutdownNow();
    super.handleOnDestroy();
  }

  @PluginMethod
  public void getBluetoothState(PluginCall call) {
    JSObject r = new JSObject();
    r.put("apiLevel", Build.VERSION.SDK_INT);
    r.put("supported", hasBluetoothHardware());
    BluetoothAdapter adapter = adapter();
    r.put("enabled", adapter != null && adapter.isEnabled());
    r.put("connectPermission", hasConnectPermission());
    r.put("scanPermission", hasScanPermission());
    r.put("classicSupported", hasBluetoothHardware());
    r.put("bleSupported", getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE));
    r.put("nativeTransport", true);
    call.resolve(r);
  }

  @PluginMethod
  public void requestPermissions(PluginCall call) {
    List<String> needed = new ArrayList<>();
    if (Build.VERSION.SDK_INT >= 31) {
      addIfMissing(needed, Manifest.permission.BLUETOOTH_CONNECT);
      addIfMissing(needed, Manifest.permission.BLUETOOTH_SCAN);
    } else {
      addIfMissing(needed, Manifest.permission.ACCESS_FINE_LOCATION);
    }
    if (needed.isEmpty()) {
      getBluetoothState(call);
      return;
    }
    ActivityCompat.requestPermissions(getActivity(), needed.toArray(new String[0]), 0xB7);
    pollPermissionResult(call, 0);
  }

  private void pollPermissionResult(PluginCall call, int attempt) {
    if ((hasConnectPermission() && hasScanPermission()) || attempt >= 25) {
      getBluetoothState(call);
      return;
    }
    main.postDelayed(() -> pollPermissionResult(call, attempt + 1), 200);
  }

  @SuppressLint("MissingPermission")
  @PluginMethod
  public void getPairedDevices(PluginCall call) {
    if (!ensureReady(call, false)) return;
    JSArray devices = new JSArray();
    BluetoothAdapter adapter = adapter();
    if (adapter == null) {
      JSObject r = new JSObject();
      r.put("devices", devices);
      call.resolve(r);
      return;
    }
    try {
      for (BluetoothDevice d : adapter.getBondedDevices()) {
        devices.put(deviceObject(d, listingTransport(d), true, bondState(d), true));
      }
    } catch (SecurityException e) {
      call.reject("Bluetooth permission is required to find printers.", "permission_denied");
      return;
    }
    JSObject r = new JSObject();
    r.put("devices", devices);
    call.resolve(r);
  }

  @SuppressLint("MissingPermission")
  @PluginMethod
  public void scanDevices(PluginCall call) {
    if (!ensureReady(call, true)) return;
    int timeout = call.getData() != null ? call.getData().optInt("timeoutMs", SCAN_DEFAULT_MS) : SCAN_DEFAULT_MS;
    timeout = Math.max(3000, Math.min(timeout, 20000));
    stopScanInternal();
    scanHits.clear();
    pendingScanCall = call;
    scanning.set(true);

    BluetoothAdapter adapter = adapter();
    discoveryReceiver = new BroadcastReceiver() {
      @Override
      public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (BluetoothDevice.ACTION_FOUND.equals(action)) {
          BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
          if (device != null) rememberScan(device, "classic");
        } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
          finishScan();
        }
      }
    };
    IntentFilter filter = new IntentFilter(BluetoothDevice.ACTION_FOUND);
    filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
    if (Build.VERSION.SDK_INT >= 33) {
      getContext().registerReceiver(discoveryReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
    } else {
      getContext().registerReceiver(discoveryReceiver, filter);
    }

    try {
      adapter.startDiscovery();
    } catch (SecurityException e) {
      scanning.set(false);
      pendingScanCall = null;
      call.reject("Bluetooth permission is required to find printers.", "permission_denied");
      return;
    }

    if (Build.VERSION.SDK_INT >= 21 && adapter.getBluetoothLeScanner() != null) {
      leScanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
          if (result != null && result.getDevice() != null) {
            rememberScan(result.getDevice(), "ble");
          }
        }
      };
      try {
        adapter.getBluetoothLeScanner().startScan(leScanCallback);
      } catch (SecurityException ignored) {
        /* Classic scan may still succeed */
      }
    }

    scanTimeout = this::finishScan;
    main.postDelayed(scanTimeout, timeout);
  }

  @PluginMethod
  public void stopScan(PluginCall call) {
    finishScan();
    JSObject r = new JSObject();
    r.put("stopped", true);
    call.resolve(r);
  }

  @PluginMethod
  public void connect(PluginCall call) {
    String deviceId = call.getString("deviceId");
    String mode = call.getString("mode");
    if (deviceId == null || deviceId.trim().isEmpty()) {
      call.reject("Select a Bluetooth printer in Hardware settings.", "no_device");
      return;
    }
    if (!ensureReady(call, false)) return;
    io.execute(() -> {
      try {
        String transport = resolveTransport(deviceId, mode);
        if ("ble".equals(transport)) {
          connectBle(deviceId);
          JSObject r = new JSObject();
          r.put("ok", true);
          r.put("status", "connected");
          r.put("transport", transport);
          call.resolve(r);
          return;
        }
        // Classic: resolve + validate only. Do not open RFCOMM here — that
        // occupies cheap printers and makes the following Test fail.
        ClassicPrintResult ready = resolveClassicDevice(deviceId);
        if (ready.ok) {
          call.resolve(ready.toJs());
        } else {
          call.reject(ready.displayMessage(), ready.code, null, ready.toJs());
        }
      } catch (PrinterTransportException e) {
        call.reject(e.userMessage, e.code, e, e.toJs());
      } catch (Exception e) {
        ClassicPrintResult fail = ClassicPrintResult.fail(deviceId, "RFCOMM_CONNECT", e);
        call.reject(fail.displayMessage(), fail.code, e, fail.toJs());
      }
    });
  }

  @PluginMethod
  public void disconnect(PluginCall call) {
    String deviceId = call.getString("deviceId");
    io.execute(() -> {
      if (deviceId == null || deviceId.trim().isEmpty()) {
        closeAllSessions();
      } else {
        closeSession(deviceId);
      }
      JSObject r = new JSObject();
      r.put("ok", true);
      r.put("status", "disconnected");
      call.resolve(r);
    });
  }

  @PluginMethod
  public void printEscPos(PluginCall call) {
    String deviceId = call.getString("deviceId");
    byte[] data = readBytes(call);
    if (deviceId == null || deviceId.trim().isEmpty()) {
      call.reject("Select a Bluetooth printer in Hardware settings.", "no_device");
      return;
    }
    if (data == null || data.length == 0) {
      call.reject("Nothing to print.", "empty_payload");
      return;
    }
    if (!ensureReady(call, false)) return;
    io.execute(() -> {
      try {
        String transport = resolveTransport(deviceId, call.getString("mode"));
        if ("ble".equals(transport)) {
          writeToDevice(deviceId, "ble", data);
          JSObject r = new JSObject();
          r.put("ok", true);
          r.put("status", "printed");
          r.put("transport", "ble");
          r.put("bytesWritten", data.length);
          call.resolve(r);
          return;
        }
        String address;
        try {
          address = extractAddress(deviceId);
        } catch (PrinterTransportException lookup) {
          ClassicPrintResult fail = ClassicPrintResult.fail(deviceId, "DEVICE_LOOKUP", lookup);
          fail.code = lookup.code;
          fail.errorType = lookup.errorType != null ? lookup.errorType : "IllegalArgumentException";
          fail.errorMessage = lookup.causeMessage != null ? lookup.causeMessage : lookup.userMessage;
          call.reject(fail.displayMessage(), fail.code, null, fail.toJs());
          return;
        }
        ClassicPrintResult printed;
        synchronized (classicLock(address)) {
          printed = printClassicJobWithWriteRetry(deviceId, data);
        }
        if (printed.ok) {
          call.resolve(printed.toJs());
        } else {
          call.reject(printed.displayMessage(), printed.code, null, printed.toJs());
        }
      } catch (PrinterTransportException e) {
        call.reject(e.userMessage, e.code, e, e.toJs());
      } catch (Exception e) {
        ClassicPrintResult fail = ClassicPrintResult.fail(deviceId, "WRITE", e);
        call.reject(fail.displayMessage(), fail.code, e, fail.toJs());
      }
    });
  }

  @PluginMethod
  public void testPrint(PluginCall call) {
    byte[] data = readBytes(call);
    if (data == null || data.length == 0) {
      data = defaultTestBytes();
    }
    call.getData().put("data", toJsArray(data));
    printEscPos(call);
  }

  @PluginMethod
  public void connectionStatus(PluginCall call) {
    String deviceId = call.getString("deviceId");
    JSObject r = new JSObject();
    if (deviceId == null || deviceId.trim().isEmpty()) {
      r.put("status", classicSessions.isEmpty() && bleSessions.isEmpty() ? "disconnected" : "connected");
      call.resolve(r);
      return;
    }
    ClassicSession cs = classicSessions.get(normalizeId(deviceId));
    BleSession bs = bleSessions.get(normalizeId(deviceId));
    if (cs != null && cs.socket != null && cs.socket.isConnected()) {
      r.put("status", "connected");
      r.put("transport", "classic");
    } else if (bs != null && bs.connected.get()) {
      r.put("status", "connected");
      r.put("transport", "ble");
    } else {
      r.put("status", "disconnected");
    }
    call.resolve(r);
  }

  @SuppressLint("MissingPermission")
  @PluginMethod
  public void pairDevice(PluginCall call) {
    String deviceId = call.getString("deviceId");
    if (deviceId == null || deviceId.trim().isEmpty()) {
      call.reject("Select a Bluetooth printer in Hardware settings.", "no_device");
      return;
    }
    if (!ensureReady(call, false)) return;
    try {
      BluetoothDevice device = resolveDevice(deviceId);
      if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
        JSObject r = new JSObject();
        r.put("ok", true);
        r.put("bonded", true);
        call.resolve(r);
        return;
      }
      boolean started = device.createBond();
      JSObject r = new JSObject();
      r.put("ok", started);
      r.put("bonded", device.getBondState() == BluetoothDevice.BOND_BONDED);
      r.put("systemPairing", true);
      call.resolve(r);
    } catch (PrinterTransportException e) {
      call.reject(e.userMessage, e.code);
    } catch (SecurityException e) {
      call.reject("Bluetooth permission is required to find printers.", "permission_denied");
    }
  }

  private void writeToDevice(String deviceId, String mode, byte[] data) throws Exception {
    String transport = resolveTransport(deviceId, mode);
    if ("ble".equals(transport)) {
      BleSession session = connectBle(deviceId);
      session.write(data);
      return;
    }
    String address = extractAddress(deviceId);
    ClassicPrintResult printed;
    synchronized (classicLock(address)) {
      printed = printClassicJobWithWriteRetry(deviceId, data);
    }
    if (!printed.ok) {
      throw new PrinterTransportException(printed.code, printed.displayMessage(), printed.stage, printed.errorType, printed.errorMessage);
    }
  }

  private Object classicLock(String address) {
    return classicLocks.computeIfAbsent(address, key -> new Object());
  }

  /**
   * Fresh RFCOMM job. If the socket connected but WRITE/FLUSH failed, retry
   * exactly once on a new socket. Connection failures stay on the
   * insecure → secure → channel 1 path — no extra connect loops.
   */
  private ClassicPrintResult printClassicJobWithWriteRetry(String deviceId, byte[] data) {
    ClassicPrintResult first = printClassicJob(deviceId, data, false);
    if (first.ok) return first;
    boolean writeAfterConnect = first.connectionSucceeded
      && ("WRITE".equals(first.stage) || "FLUSH".equals(first.stage) || "OUTPUT_STREAM".equals(first.stage));
    if (!writeAfterConnect) return first;
    log("write failed — one reconnect retry");
    try {
      Thread.sleep(CLASSIC_WRITE_RETRY_SETTLE_MS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return first;
    }
    return printClassicJob(deviceId, data, false);
  }

  @SuppressLint("MissingPermission")
  private ClassicPrintResult resolveClassicDevice(String deviceId) {
    ClassicPrintResult result = new ClassicPrintResult();
    result.transport = "classic";
    result.deviceId = deviceId;
    result.stage = "DEVICE_LOOKUP";
    try {
      log("device lookup");
      log("transport=classic");
      BluetoothDevice device = resolveDevice(deviceId);
      result.deviceName = safeName(device);
      result.address = safeAddress(device);
      log("device=" + result.deviceName);
      log("address=" + result.address);
      requireBondedClassic(device);
      log("bonded=true");
      result.ok = true;
      result.status = "ready";
      result.writeSucceeded = false;
      result.flushSucceeded = false;
      result.socketClosed = true;
      return result;
    } catch (PrinterTransportException e) {
      result.ok = false;
      result.code = e.code;
      result.stage = e.stage != null ? e.stage : "DEVICE_LOOKUP";
      result.errorType = e.errorType != null ? e.errorType : "PrinterTransportException";
      result.errorMessage = e.causeMessage != null ? e.causeMessage : e.userMessage;
      logFail(result.stage, e);
      return result;
    } catch (Exception e) {
      result.ok = false;
      result.code = "classic_spp_failed";
      result.errorType = e.getClass().getSimpleName();
      result.errorMessage = e.getMessage();
      logFail("DEVICE_LOOKUP", e);
      return result;
    }
  }

  /**
   * One Classic SPP job: cancel discovery → connect → write → flush → close.
   * Fresh socket every time. Success only after close.
   */
  @SuppressLint("MissingPermission")
  private ClassicPrintResult printClassicJob(String deviceId, byte[] data, boolean probeOnly) {
    closeSession(deviceId);
    ClassicPrintResult result = new ClassicPrintResult();
    result.transport = "classic";
    result.deviceId = deviceId;
    BluetoothSocket socket = null;
    OutputStream out = null;
    try {
      result.stage = "DEVICE_LOOKUP";
      log("device lookup");
      log("transport=classic");
      BluetoothDevice device = resolveDevice(deviceId);
      result.deviceName = safeName(device);
      result.address = safeAddress(device);
      log("device=" + result.deviceName);
      log("address=" + result.address);
      requireBondedClassic(device);
      log("bonded=true");

      result.stage = "SOCKET_CREATE";
      log("creating RFCOMM socket");
      log("socket strategy=insecure-spp then secure-spp then channel1");
      socket = openClassicSocket(device, result);
      result.stage = "RFCOMM_CONNECT";
      result.connectionSucceeded = socket != null && socket.isConnected();
      if (!result.connectionSucceeded) {
        throw new PrinterTransportException(
          "connect_failed",
          "RFCOMM connection failed",
          "RFCOMM_CONNECT",
          result.errorType,
          result.errorMessage
        );
      }
      log("connected");
      Thread.sleep(CLASSIC_SETTLE_AFTER_CONNECT_MS);

      result.stage = "OUTPUT_STREAM";
      out = socket.getOutputStream();
      log("output stream acquired");

      if (!probeOnly) {
        if (data == null || data.length == 0) {
          throw new PrinterTransportException("empty_payload", "Nothing to print.", "WRITE", null, null);
        }
        result.stage = "WRITE";
        result.bytesRequested = data.length;
        log("bytes requested=" + data.length);
        if (data.length >= 2) {
          log("head=" + String.format(Locale.US, "%02X %02X", data[0] & 0xff, data[1] & 0xff));
        }
        boolean pace = data.length > CLASSIC_CHUNK;
        if (pace) {
          log("pacing large job chunk=" + CLASSIC_CHUNK + " pauseMs=" + CLASSIC_CHUNK_PAUSE_MS);
        }
        int offset = 0;
        while (offset < data.length) {
          int n = Math.min(CLASSIC_CHUNK, data.length - offset);
          out.write(data, offset, n);
          offset += n;
          if (pace && offset < data.length) {
            out.flush();
            Thread.sleep(CLASSIC_CHUNK_PAUSE_MS);
          }
        }
        result.bytesWritten = offset;
        if (result.bytesWritten != result.bytesRequested) {
          throw new PrinterTransportException(
            "write_failed",
            "WRITE failed: wrote " + result.bytesWritten + " of " + result.bytesRequested,
            "WRITE",
            "IOException",
            "incomplete write"
          );
        }
        result.writeSucceeded = true;
        log("bytes written=" + result.bytesWritten);

        result.stage = "FLUSH";
        out.flush();
        result.flushSucceeded = true;
        log("flush complete");
        log("settle=" + CLASSIC_SETTLE_AFTER_FLUSH_MS);
        Thread.sleep(CLASSIC_SETTLE_AFTER_FLUSH_MS);
      } else {
        result.bytesWritten = 0;
        result.writeSucceeded = true;
        result.flushSucceeded = true;
      }

      result.stage = "CLOSE";
      result.socketClosed = closeQuietly(out, socket);
      socket = null;
      out = null;
      log("socket closed");
      if (!result.socketClosed) {
        throw new PrinterTransportException("close_failed", "Socket close failed", "CLOSE", "IOException", "close failed");
      }
      result.ok = true;
      result.stage = probeOnly ? "RFCOMM_CONNECT" : "CLOSE";
      result.status = probeOnly ? "connected" : "sent";
      log("success");
      return result;
    } catch (PrinterTransportException e) {
      result.ok = false;
      result.code = e.code;
      result.stage = e.stage != null ? e.stage : result.stage;
      result.errorType = e.errorType != null ? e.errorType : "PrinterTransportException";
      result.errorMessage = e.causeMessage != null ? e.causeMessage : e.userMessage;
      logFail(result.stage, e);
      result.socketClosed = closeQuietly(out, socket);
      return result;
    } catch (Exception e) {
      result.ok = false;
      result.code = "classic_spp_failed";
      result.errorType = e.getClass().getSimpleName();
      result.errorMessage = e.getMessage();
      logFail(result.stage, e);
      result.socketClosed = closeQuietly(out, socket);
      return result;
    }
  }

  @SuppressLint("MissingPermission")
  private BluetoothSocket openClassicSocket(BluetoothDevice device, ClassicPrintResult diag) throws Exception {
    long deadline = System.currentTimeMillis() + CONNECT_TIMEOUT_MS;
    Exception last = null;

    // Cheap thermal printers typically accept insecure SPP. A hanging secure
    // attempt used to consume the whole 8s budget so insecure never ran.
    SocketAttempt insecureSpp = tryRfcomm(device, SPP_UUID, false, deadline, "insecure SPP");
    if (insecureSpp.ok) return insecureSpp.socket;
    last = firstError(last, insecureSpp.error);

    SocketAttempt secureSpp = tryRfcomm(device, SPP_UUID, true, deadline, "secure SPP");
    if (secureSpp.ok) return secureSpp.socket;
    last = firstError(last, secureSpp.error);

    SocketAttempt channel1 = tryChannel1(device, deadline);
    if (channel1.ok) return channel1.socket;
    last = firstError(last, channel1.error);

    if (diag != null && last != null) {
      diag.errorType = last.getClass().getSimpleName();
      diag.errorMessage = last.getMessage();
    }
    throw new PrinterTransportException(
      "connect_failed",
      "RFCOMM connection failed",
      "RFCOMM_CONNECT",
      last != null ? last.getClass().getSimpleName() : "IOException",
      last != null ? last.getMessage() : "socket.connect() failed"
    );
  }

  @SuppressLint("MissingPermission")
  private SocketAttempt tryRfcomm(
    BluetoothDevice device,
    UUID uuid,
    boolean secure,
    long deadline,
    String kind
  ) {
    long remaining = deadline - System.currentTimeMillis();
    if (remaining < 400) return SocketAttempt.fail(new IOException("RFCOMM budget exhausted before " + kind));
    try {
      log("creating RFCOMM socket kind=" + kind);
      BluetoothSocket socket = secure
        ? device.createRfcommSocketToServiceRecord(uuid)
        : device.createInsecureRfcommSocketToServiceRecord(uuid);
      return connectSocket(socket, Math.min(CLASSIC_ATTEMPT_TIMEOUT_MS, remaining));
    } catch (Exception e) {
      logFail("SOCKET_CREATE", e);
      return SocketAttempt.fail(e);
    }
  }

  @SuppressLint("MissingPermission")
  private SocketAttempt tryChannel1(BluetoothDevice device, long deadline) {
    long remaining = deadline - System.currentTimeMillis();
    if (remaining < 400) return SocketAttempt.fail(new IOException("RFCOMM budget exhausted before channel 1"));
    try {
      log("creating RFCOMM socket kind=channel1");
      Method m = device.getClass().getMethod("createRfcommSocket", int.class);
      BluetoothSocket reflected = (BluetoothSocket) m.invoke(device, 1);
      if (reflected == null) return SocketAttempt.fail(new IOException("createRfcommSocket(1) returned null"));
      return connectSocket(reflected, Math.min(CLASSIC_ATTEMPT_TIMEOUT_MS, remaining));
    } catch (Exception e) {
      logFail("SOCKET_CREATE", e);
      return SocketAttempt.fail(e);
    }
  }

  private Exception firstError(Exception current, Exception next) {
    return current != null ? current : next;
  }

  @SuppressLint("MissingPermission")
  private SocketAttempt connectSocket(BluetoothSocket socket, long timeoutMs) {
    BluetoothAdapter adapter = adapter();
    if (adapter != null) {
      try {
        adapter.cancelDiscovery();
        log("cancelled discovery before RFCOMM connect");
      } catch (SecurityException e) {
        logFail("RFCOMM_CONNECT", e);
      }
    }
    AtomicReference<Exception> connectError = new AtomicReference<>();
    Thread connector = new Thread(() -> {
      try {
        log("connecting");
        socket.connect();
      } catch (IOException e) {
        connectError.set(e);
      } catch (Exception e) {
        connectError.set(e);
      }
    }, "waka-bt-connect");
    connector.start();
    try {
      connector.join(Math.max(400L, timeoutMs));
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      connectError.compareAndSet(null, e);
    }
    if (connector.isAlive() || !socket.isConnected()) {
      try {
        socket.close();
      } catch (IOException ignored) {}
      if (connector.isAlive()) {
        try {
          connector.join(400);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
      Exception err = connectError.get();
      if (err == null) {
        err = new IOException("RFCOMM connect timed out after " + timeoutMs + "ms");
      }
      return SocketAttempt.fail(err);
    }
    return SocketAttempt.ok(socket);
  }

  @SuppressLint("MissingPermission")
  private BleSession connectBle(String deviceId) throws Exception {
    String key = normalizeId(deviceId);
    BleSession existing = bleSessions.get(key);
    if (existing != null && existing.connected.get() && existing.writable != null) {
      return existing;
    }
    closeSession(key);
    BluetoothDevice device = resolveDevice(deviceId);
    CountDownLatch ready = new CountDownLatch(1);
    AtomicReference<Exception> fail = new AtomicReference<>();
    BleSession session = new BleSession();
    BluetoothGattCallback cb = new BluetoothGattCallback() {
      @Override
      public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          gatt.discoverServices();
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          session.connected.set(false);
          if (ready.getCount() > 0) {
            fail.compareAndSet(null, new PrinterTransportException("connect_failed", couldNotConnectMessage(deviceId)));
            ready.countDown();
          }
        }
      }

      @Override
      public void onServicesDiscovered(BluetoothGatt gatt, int status) {
        BluetoothGattCharacteristic chr = pickWritableCharacteristic(gatt);
        if (chr == null) {
          fail.compareAndSet(
            null,
            new PrinterTransportException(
              "unsupported_device",
              "This Bluetooth device does not expose a supported printer connection."
            )
          );
          ready.countDown();
          return;
        }
        session.writable = chr;
        session.canWriteNoResponse = (chr.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
        try {
          gatt.requestMtu(185);
        } catch (Exception ignored) {}
        session.connected.set(true);
        ready.countDown();
      }

      @Override
      public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
        if (status == BluetoothGatt.GATT_SUCCESS && mtu > 3) {
          session.mtu.set(mtu);
        }
      }

      @Override
      public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
        session.writeOk.set(status == BluetoothGatt.GATT_SUCCESS);
        CountDownLatch latch = session.writeLatch.get();
        if (latch != null) latch.countDown();
      }
    };
    BluetoothGatt gatt = device.connectGatt(getContext(), false, cb, BluetoothDevice.TRANSPORT_LE);
    if (gatt == null) {
      throw new PrinterTransportException("connect_failed", couldNotConnectMessage(deviceId));
    }
    session.gatt = gatt;
    if (!ready.await(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
      try {
        gatt.disconnect();
        gatt.close();
      } catch (Exception ignored) {}
      throw new PrinterTransportException("connect_failed", couldNotConnectMessage(deviceId));
    }
    if (fail.get() != null) {
      try {
        gatt.disconnect();
        gatt.close();
      } catch (Exception ignored) {}
      Exception err = fail.get();
      if (err instanceof PrinterTransportException) throw err;
      throw new PrinterTransportException("connect_failed", couldNotConnectMessage(deviceId));
    }
    bleSessions.put(key, session);
    return session;
  }

  private BluetoothGattCharacteristic pickWritableCharacteristic(BluetoothGatt gatt) {
    BluetoothGattCharacteristic preferred = findChar(gatt, BLE_SVC_FFE0, BLE_CHR_FFE1);
    if (preferred != null && isWritable(preferred)) return preferred;
    preferred = findChar(gatt, BLE_SVC_18F0, BLE_CHR_2AF1);
    if (preferred != null && isWritable(preferred)) return preferred;
    BluetoothGattCharacteristic first = null;
    for (BluetoothGattService svc : gatt.getServices()) {
      if (svc == null) continue;
      for (BluetoothGattCharacteristic c : svc.getCharacteristics()) {
        if (!isWritable(c)) continue;
        if (first == null) first = c;
        String name = String.valueOf(c.getUuid()).toLowerCase(Locale.US);
        if (name.contains("ffe1") || name.contains("2af1") || name.contains("ff01")) return c;
      }
    }
    return first;
  }

  private BluetoothGattCharacteristic findChar(BluetoothGatt gatt, UUID service, UUID chr) {
    BluetoothGattService svc = gatt.getService(service);
    return svc != null ? svc.getCharacteristic(chr) : null;
  }

  private boolean isWritable(BluetoothGattCharacteristic c) {
    int p = c.getProperties();
    return (p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
      || (p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
  }

  @SuppressLint("MissingPermission")
  private BluetoothDevice resolveDevice(String deviceId) throws PrinterTransportException {
    String address = extractAddress(deviceId);
    BluetoothAdapter adapter = adapter();
    if (adapter == null) {
      throw new PrinterTransportException("unsupported", "Bluetooth is not supported on this device.");
    }
    try {
      BluetoothDevice device = adapter.getRemoteDevice(address);
      if (device == null) {
        throw new PrinterTransportException("not_found", couldNotConnectMessage(deviceId));
      }
      return device;
    } catch (IllegalArgumentException e) {
      throw new PrinterTransportException("not_found", couldNotConnectMessage(deviceId));
    }
  }

  /** Dual/unknown radios list as Classic so a cheap SPP printer is not offered as BLE. */
  private String listingTransport(BluetoothDevice device) {
    try {
      if (device.getType() == BluetoothDevice.DEVICE_TYPE_LE) return "ble";
    } catch (Exception ignored) {}
    return "classic";
  }

  private String resolveTransport(String deviceId, String mode) {
    if ("ble".equalsIgnoreCase(mode) || (deviceId != null && deviceId.toLowerCase(Locale.US).startsWith("ble:"))) {
      return "ble";
    }
    return "classic";
  }

  @SuppressLint("MissingPermission")
  private void rememberScan(BluetoothDevice device, String scanSource) {
    try {
      String transport = listingTransport(device);
      if ("ble".equals(scanSource) && !"ble".equals(transport)) {
        return;
      }
      String id = transport + ":" + device.getAddress();
      synchronized (scanHits) {
        JSObject existing = scanHits.get(id);
        JSObject next = deviceObject(device, transport, false, bondState(device), false);
        if (existing != null && existing.optBoolean("likelyPrinter", false)) {
          next.put("likelyPrinter", true);
        }
        scanHits.put(id, next);
      }
    } catch (SecurityException ignored) {}
  }

  @SuppressLint("MissingPermission")
  private void finishScan() {
    boolean wasScanning = scanning.getAndSet(false);
    if (scanTimeout != null) {
      main.removeCallbacks(scanTimeout);
      scanTimeout = null;
    }
    BluetoothAdapter adapter = adapter();
    if (adapter != null) {
      try {
        adapter.cancelDiscovery();
      } catch (SecurityException ignored) {}
      BluetoothLeScanner le = adapter.getBluetoothLeScanner();
      if (le != null && leScanCallback != null) {
        try {
          le.stopScan(leScanCallback);
        } catch (SecurityException ignored) {}
      }
    }
    leScanCallback = null;
    if (discoveryReceiver != null) {
      try {
        getContext().unregisterReceiver(discoveryReceiver);
      } catch (Exception ignored) {}
      discoveryReceiver = null;
    }
    PluginCall call = pendingScanCall;
    pendingScanCall = null;
    if (call != null) {
      JSObject r = new JSObject();
      r.put("devices", scanArray());
      call.resolve(r);
    } else if (!wasScanning) {
      /* nothing to resolve */
    }
  }

  private void stopScanInternal() {
    if (scanning.get() || pendingScanCall != null) {
      finishScan();
    }
  }

  private JSArray scanArray() {
    JSArray arr = new JSArray();
    synchronized (scanHits) {
      for (JSObject o : scanHits.values()) arr.put(o);
    }
    return arr;
  }

  @SuppressLint("MissingPermission")
  private JSObject deviceObject(
    BluetoothDevice device,
    String transport,
    boolean fromBondedList,
    String bond,
    boolean hideAddress
  ) {
    JSObject o = new JSObject();
    String address = "";
    try {
      address = device.getAddress();
    } catch (SecurityException ignored) {}
    String name = "";
    try {
      name = device.getName();
    } catch (SecurityException ignored) {}
    if (name == null || name.trim().isEmpty()) name = "Bluetooth device";
    o.put("id", transport + ":" + address);
    o.put("name", name);
    o.put("transport", transport);
    o.put("bonded", BluetoothDevice.BOND_BONDED == device.getBondState() || fromBondedList);
    o.put("bondState", bond);
    o.put("majorClass", majorClassName(device));
    o.put("likelyPrinter", looksLikePrinter(name, device));
    o.put("fromPairedList", fromBondedList);
    if (!hideAddress && address.length() >= 5) {
      o.put("addressHint", address.substring(address.length() - 5));
    }
    return o;
  }

  private String bondState(BluetoothDevice device) {
    try {
      int s = device.getBondState();
      if (s == BluetoothDevice.BOND_BONDED) return "bonded";
      if (s == BluetoothDevice.BOND_BONDING) return "bonding";
    } catch (SecurityException ignored) {}
    return "none";
  }

  private String majorClassName(BluetoothDevice device) {
    try {
      BluetoothClass cls = device.getBluetoothClass();
      if (cls == null) return "unknown";
      int major = cls.getMajorDeviceClass();
      if (major == BluetoothClass.Device.Major.IMAGING) return "imaging";
      if (major == BluetoothClass.Device.Major.PERIPHERAL) return "peripheral";
      if (major == BluetoothClass.Device.Major.UNCATEGORIZED) return "uncategorized";
      if (major == BluetoothClass.Device.Major.PHONE) return "phone";
      if (major == BluetoothClass.Device.Major.AUDIO_VIDEO) return "audio";
      if (major == BluetoothClass.Device.Major.COMPUTER) return "computer";
      return "other";
    } catch (Exception e) {
      return "unknown";
    }
  }

  static boolean looksLikePrinter(String name, BluetoothDevice device) {
    String n = name == null ? "" : name.toLowerCase(Locale.US);
    if (n.contains("printer")
      || n.contains("thermal")
      || n.contains("xprinter")
      || n.contains("rongta")
      || n.contains("munbyn")
      || n.contains("goojprt")
      || n.contains("zjiang")
      || n.contains("cashino")
      || n.contains("epson")
      || n.contains("star")
      || n.contains("sunmi")
      || n.contains("pos")
      || n.contains("mtp")
      || n.contains("mobile printer")) {
      return true;
    }
    try {
      BluetoothClass cls = device.getBluetoothClass();
      return cls != null && cls.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING;
    } catch (Exception e) {
      return false;
    }
  }

  private boolean ensureReady(PluginCall call, boolean needScan) {
    if (!hasBluetoothHardware()) {
      call.reject("Bluetooth is not supported on this device.", "unsupported");
      return false;
    }
    BluetoothAdapter adapter = adapter();
    if (adapter == null || !adapter.isEnabled()) {
      call.reject("Turn on Bluetooth to connect a printer.", "bluetooth_disabled");
      return false;
    }
    if (!hasConnectPermission()) {
      call.reject("Bluetooth permission is required to find printers.", "permission_denied");
      return false;
    }
    if (needScan && !hasScanPermission()) {
      call.reject("Bluetooth permission is required to find printers.", "permission_denied");
      return false;
    }
    return true;
  }

  private boolean hasBluetoothHardware() {
    return getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH)
      && adapter() != null;
  }

  private BluetoothAdapter adapter() {
    BluetoothManager mgr = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
    return mgr != null ? mgr.getAdapter() : null;
  }

  private boolean hasConnectPermission() {
    if (Build.VERSION.SDK_INT >= 31) {
      return granted(Manifest.permission.BLUETOOTH_CONNECT);
    }
    return true;
  }

  private boolean hasScanPermission() {
    if (Build.VERSION.SDK_INT >= 31) {
      return granted(Manifest.permission.BLUETOOTH_SCAN);
    }
    return granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION);
  }

  private boolean granted(String permission) {
    return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
  }

  private void addIfMissing(List<String> needed, String permission) {
    if (!granted(permission)) needed.add(permission);
  }

  private byte[] readBytes(PluginCall call) {
    JSArray arr = call.getArray("data");
    if (arr == null) return null;
    try {
      int n = arr.length();
      byte[] out = new byte[n];
      for (int i = 0; i < n; i++) {
        int value = readUnsignedByte(arr, i);
        if (value < 0 || value > 255) return null;
        out[i] = (byte) (value & 0xff);
      }
      return out;
    } catch (Exception e) {
      logFail("WRITE", e);
      return null;
    }
  }

  private int readUnsignedByte(JSArray arr, int index) throws Exception {
    try {
      return arr.getInt(index) & 0xff;
    } catch (Exception ignored) {
      Object raw = arr.get(index);
      if (raw instanceof Number) return ((Number) raw).intValue() & 0xff;
      throw new IllegalArgumentException("data[" + index + "] is not a number");
    }
  }

  private JSArray toJsArray(byte[] data) {
    JSArray arr = new JSArray();
    for (byte b : data) arr.put(b & 0xff);
    return arr;
  }

  private byte[] defaultTestBytes() {
    return CLASSIC_DIAGNOSTIC_BYTES.clone();
  }

  private void log(String message) {
    Log.i(TAG, message);
  }

  private void logFail(String stage, Throwable error) {
    if (error == null) {
      Log.e(TAG, "stage=" + stage + " error=null");
      return;
    }
    Log.e(TAG, "stage=" + stage);
    Log.e(TAG, "exception=" + error.getClass().getName());
    Log.e(TAG, "message=" + error.getMessage());
  }

  private boolean closeQuietly(OutputStream out, BluetoothSocket socket) {
    boolean closed = true;
    if (out != null) {
      try {
        out.close();
      } catch (Exception e) {
        closed = false;
        logFail("CLOSE", e);
      }
    }
    if (socket != null) {
      try {
        socket.close();
      } catch (Exception e) {
        closed = false;
        logFail("CLOSE", e);
      }
    }
    return closed;
  }

  @SuppressLint("MissingPermission")
  private String safeName(BluetoothDevice device) {
    try {
      String name = device.getName();
      if (name != null && !name.trim().isEmpty()) return name;
    } catch (SecurityException ignored) {}
    return "Bluetooth device";
  }

  @SuppressLint("MissingPermission")
  private String safeAddress(BluetoothDevice device) {
    try {
      return device.getAddress();
    } catch (SecurityException ignored) {}
    return "";
  }

  static String extractBluetoothAddress(String deviceId) {
    String raw = deviceId == null ? "" : deviceId.trim();
    if (raw.regionMatches(true, 0, "classic:", 0, 8)) {
      raw = raw.substring(8);
    } else if (raw.regionMatches(true, 0, "ble:", 0, 4)) {
      raw = raw.substring(4);
    }
    return raw.toUpperCase(Locale.US);
  }

  private String extractAddress(String deviceId) throws PrinterTransportException {
    String address = extractBluetoothAddress(deviceId);
    if (!BluetoothAdapter.checkBluetoothAddress(address)) {
      throw new PrinterTransportException(
        "not_found",
        "Invalid Bluetooth address",
        "DEVICE_LOOKUP",
        "IllegalArgumentException",
        "Invalid Bluetooth address: " + address
      );
    }
    return address;
  }

  private String normalizeId(String deviceId) {
    try {
      String address = extractAddress(deviceId);
      String prefix = deviceId.toLowerCase(Locale.US).startsWith("ble:") ? "ble:" : "classic:";
      return prefix + address;
    } catch (Exception e) {
      return deviceId == null ? "" : deviceId;
    }
  }

  @SuppressLint("MissingPermission")
  private void requireBondedClassic(BluetoothDevice device) throws PrinterTransportException {
    try {
      if (device.getBondState() == BluetoothDevice.BOND_BONDED) return;
    } catch (SecurityException e) {
      throw new PrinterTransportException(
        "permission_denied",
        "Bluetooth permission is required to find printers.",
        "DEVICE_LOOKUP",
        "SecurityException",
        e.getMessage()
      );
    }
    throw new PrinterTransportException(
      "pairing_required",
      "Pair this printer in Android Bluetooth settings, then select it from Paired.",
      "DEVICE_LOOKUP",
      "NotBonded",
      "bondState=" + bondState(device)
    );
  }

  private String couldNotConnectMessage(String deviceId) {
    return "Could not connect to Mobile Printer.";
  }

  @SuppressLint("MissingPermission")
  private void closeSession(String deviceId) {
    String key = normalizeId(deviceId);
    ClassicSession cs = classicSessions.remove(key);
    if (cs != null) cs.close();
    BleSession bs = bleSessions.remove(key);
    if (bs != null) bs.close();
    if (!key.equals(deviceId)) {
      ClassicSession cs2 = classicSessions.remove(deviceId);
      if (cs2 != null) cs2.close();
      BleSession bs2 = bleSessions.remove(deviceId);
      if (bs2 != null) bs2.close();
    }
  }

  private void closeAllSessions() {
    for (ClassicSession s : classicSessions.values()) s.close();
    classicSessions.clear();
    for (BleSession s : bleSessions.values()) s.close();
    bleSessions.clear();
  }

  static final class SocketAttempt {
    final boolean ok;
    final BluetoothSocket socket;
    final Exception error;

    private SocketAttempt(boolean ok, BluetoothSocket socket, Exception error) {
      this.ok = ok;
      this.socket = socket;
      this.error = error;
    }

    static SocketAttempt ok(BluetoothSocket socket) {
      return new SocketAttempt(true, socket, null);
    }

    static SocketAttempt fail(Exception error) {
      return new SocketAttempt(false, null, error);
    }
  }

  static final class ClassicPrintResult {
    boolean ok;
    String status = "failed";
    String stage = "DEVICE_LOOKUP";
    String transport = "classic";
    String deviceId = "";
    String deviceName = "";
    String address = "";
    int bytesRequested = 0;
    int bytesWritten = 0;
    boolean connectionSucceeded;
    boolean writeSucceeded;
    boolean flushSucceeded;
    boolean socketClosed;
    String code = "classic_spp_failed";
    String errorType;
    String errorMessage;

    static ClassicPrintResult fail(String deviceId, String stage, Exception error) {
      ClassicPrintResult r = new ClassicPrintResult();
      r.ok = false;
      r.deviceId = deviceId;
      r.stage = stage;
      r.errorType = error != null ? error.getClass().getSimpleName() : null;
      r.errorMessage = error != null ? error.getMessage() : null;
      return r;
    }

    String displayMessage() {
      if (errorType != null && errorType.length() > 0 && errorMessage != null && errorMessage.length() > 0) {
        return "RFCOMM " + stageLabel() + " failed\n\n" + errorType + "\n" + errorMessage;
      }
      if (errorMessage != null && errorMessage.length() > 0) return errorMessage;
      if (errorType != null && errorType.length() > 0) return errorType;
      return "RFCOMM " + stageLabel() + " failed";
    }

    private String stageLabel() {
      if ("RFCOMM_CONNECT".equals(stage)) return "connection";
      if ("WRITE".equals(stage)) return "write";
      if ("FLUSH".equals(stage)) return "flush";
      if ("CLOSE".equals(stage)) return "close";
      if ("OUTPUT_STREAM".equals(stage)) return "output stream";
      if ("SOCKET_CREATE".equals(stage)) return "socket create";
      if ("DEVICE_LOOKUP".equals(stage)) return "device lookup";
      return stage != null ? stage.toLowerCase(Locale.US) : "operation";
    }

    JSObject toJs() {
      JSObject o = new JSObject();
      o.put("ok", ok);
      o.put("status", status);
      o.put("stage", stage);
      o.put("transport", transport);
      o.put("deviceId", deviceId);
      o.put("deviceName", deviceName);
      o.put("address", address);
      o.put("bytesRequested", bytesRequested);
      o.put("bytesWritten", bytesWritten);
      o.put("connectionSucceeded", connectionSucceeded);
      o.put("writeSucceeded", writeSucceeded);
      o.put("flushSucceeded", flushSucceeded);
      o.put("socketClosed", socketClosed);
      o.put("errorType", errorType);
      o.put("errorMessage", errorMessage);
      o.put("code", code);
      return o;
    }
  }

  static final class PrinterTransportException extends Exception {
    final String code;
    final String userMessage;
    final String stage;
    final String errorType;
    final String causeMessage;

    PrinterTransportException(String code, String userMessage) {
      this(code, userMessage, null, null, null);
    }

    PrinterTransportException(
      String code,
      String userMessage,
      String stage,
      String errorType,
      String causeMessage
    ) {
      super(userMessage);
      this.code = code;
      this.userMessage = userMessage;
      this.stage = stage;
      this.errorType = errorType;
      this.causeMessage = causeMessage;
    }

    JSObject toJs() {
      JSObject o = new JSObject();
      o.put("ok", false);
      o.put("code", code);
      o.put("stage", stage);
      o.put("errorType", errorType);
      o.put("errorMessage", causeMessage != null ? causeMessage : userMessage);
      return o;
    }
  }

  static final class ClassicSession {
    final BluetoothSocket socket;
    final OutputStream out;

    ClassicSession(BluetoothSocket socket) throws IOException {
      this.socket = socket;
      this.out = socket.getOutputStream();
    }

    void write(byte[] data) throws IOException {
      int offset = 0;
      while (offset < data.length) {
        int n = Math.min(CLASSIC_CHUNK, data.length - offset);
        out.write(data, offset, n);
        out.flush();
        offset += n;
        if (offset < data.length) {
          try {
            Thread.sleep(CLASSIC_CHUNK_PAUSE_MS);
          } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
            break;
          }
        }
      }
    }

    void close() {
      try {
        out.close();
      } catch (Exception ignored) {}
      try {
        socket.close();
      } catch (Exception ignored) {}
    }
  }

  static final class BleSession {
    BluetoothGatt gatt;
    BluetoothGattCharacteristic writable;
    boolean canWriteNoResponse;
    final AtomicBoolean connected = new AtomicBoolean(false);
    final AtomicInteger mtu = new AtomicInteger(23);
    final AtomicBoolean writeOk = new AtomicBoolean(true);
    final AtomicReference<CountDownLatch> writeLatch = new AtomicReference<>();

    @SuppressLint("MissingPermission")
    void write(byte[] data) throws Exception {
      if (gatt == null || writable == null || !connected.get()) {
        throw new PrinterTransportException(
          "connect_failed",
          "Could not connect to Mobile Printer."
        );
      }
      int chunk = Math.max(20, mtu.get() - 3);
      int writeType = canWriteNoResponse
        ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
      int offset = 0;
      while (offset < data.length) {
        int n = Math.min(chunk, data.length - offset);
        byte[] part = new byte[n];
        System.arraycopy(data, offset, part, 0, n);
        if (!canWriteNoResponse) {
          CountDownLatch latch = new CountDownLatch(1);
          writeLatch.set(latch);
          writeOk.set(false);
          enqueueCharacteristicWrite(part, writeType);
          if (!latch.await(3, TimeUnit.SECONDS) || !writeOk.get()) {
            throw new PrinterTransportException("write_failed", "Could not connect to Mobile Printer.");
          }
        } else {
          enqueueCharacteristicWrite(part, writeType);
          Thread.sleep(12);
        }
        offset += n;
      }
    }

    @SuppressLint("MissingPermission")
    void enqueueCharacteristicWrite(byte[] part, int writeType) throws Exception {
      if (Build.VERSION.SDK_INT >= 33) {
        int code = gatt.writeCharacteristic(writable, part, writeType);
        if (code != android.bluetooth.BluetoothStatusCodes.SUCCESS) {
          throw new PrinterTransportException("write_failed", "Could not connect to Mobile Printer.");
        }
        return;
      }
      writable.setValue(part);
      writable.setWriteType(writeType);
      if (!gatt.writeCharacteristic(writable)) {
        throw new PrinterTransportException("write_failed", "Could not connect to Mobile Printer.");
      }
    }

    @SuppressLint("MissingPermission")
    void close() {
      connected.set(false);
      try {
        if (gatt != null) {
          gatt.disconnect();
          gatt.close();
        }
      } catch (Exception ignored) {}
      gatt = null;
      writable = null;
    }
  }
}
