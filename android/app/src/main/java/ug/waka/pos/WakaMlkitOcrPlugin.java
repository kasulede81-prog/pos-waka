package ug.waka.pos;

import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * On-device OCR via Google ML Kit Text Recognition (Latin script).
 * Returns structured blocks + optional per-element confidence when supported by the SDK.
 */
@CapacitorPlugin(name = "WakaMlkitOcr")
public class WakaMlkitOcrPlugin extends Plugin {

  @PluginMethod
  public void isAvailable(PluginCall call) {
    JSObject r = new JSObject();
    r.put("available", true);
    r.put("latinScript", true);
    call.resolve(r);
  }

  @PluginMethod
  public void recognizeText(PluginCall call) {
    String rawPath = call.getString("imagePath");
    if (rawPath == null || rawPath.isEmpty()) {
      call.reject("imagePath is required");
      return;
    }

    final InputImage image;
    try {
      image = buildInputImage(rawPath);
    } catch (Exception e) {
      call.reject("Could not read image: " + e.getMessage());
      return;
    }

    TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
    recognizer
      .process(image)
      .addOnSuccessListener(
        visionText -> {
          try {
            JSObject ret = new JSObject();
            ret.put("fullText", visionText.getText() != null ? visionText.getText() : "");
            JSArray blocks = new JSArray();
            for (Text.TextBlock block : visionText.getTextBlocks()) {
              if (block == null) continue;
              JSObject b = new JSObject();
              String bt = block.getText() != null ? block.getText() : "";
              b.put("text", bt);
              JSArray lines = new JSArray();
              Float maxConf = null;
              if (block.getLines() != null) {
                for (Text.Line line : block.getLines()) {
                  if (line == null) continue;
                  String lt = line.getText() != null ? line.getText() : "";
                  lines.put(lt);
                  if (line.getElements() != null) {
                    for (Text.Element el : line.getElements()) {
                      Float c = safeElementConfidence(el);
                      if (c != null) {
                        maxConf = maxConf == null ? c : Math.max(maxConf, c);
                      }
                    }
                  }
                }
              }
              b.put("lines", lines);
              if (maxConf != null) {
                b.put("mlConfidence", maxConf.doubleValue());
              }
              blocks.put(b);
            }
            ret.put("blocks", blocks);
            call.resolve(ret);
          } catch (Exception ex) {
            call.reject("OCR serialization failed: " + ex.getMessage());
          }
        })
      .addOnFailureListener(e -> call.reject(e.getMessage() != null ? e.getMessage() : "OCR failed"));
  }

  private InputImage buildInputImage(String rawPath) throws Exception {
    String path = rawPath.trim();
    if (path.startsWith("content:")) {
      return InputImage.fromFilePath(getContext(), copyContentUriToCache(Uri.parse(path)));
    }
    String filePath = path;
    if (path.startsWith("file:")) {
      String p = Uri.parse(path).getPath();
      if (p != null) filePath = p;
    }
    return InputImage.fromFilePath(getContext(), filePath);
  }

  /**
   * InputImage.fromFilePath does not accept content:// URIs; copy to cache so ML Kit can read a path.
   */
  private String copyContentUriToCache(Uri uri) throws Exception {
    java.io.InputStream in = getContext().getContentResolver().openInputStream(uri);
    if (in == null) throw new Exception("Cannot open content URI");
    java.io.File out = new java.io.File(getContext().getCacheDir(), "waka_ocr_" + System.currentTimeMillis() + ".jpg");
    java.io.FileOutputStream fos = new java.io.FileOutputStream(out);
    byte[] buf = new byte[8192];
    int n;
    while ((n = in.read(buf)) > 0) {
      fos.write(buf, 0, n);
    }
    fos.close();
    in.close();
    return out.getAbsolutePath();
  }

  private static Float safeElementConfidence(Text.Element element) {
    if (element == null) return null;
    try {
      java.lang.reflect.Method m = element.getClass().getMethod("getConfidence");
      Object o = m.invoke(element);
      if (o instanceof Float) return (Float) o;
    } catch (Throwable ignored) {
    }
    return null;
  }
}
