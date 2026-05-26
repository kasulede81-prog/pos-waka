package ug.waka.pos;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(WakaMlkitOcrPlugin.class);
    super.onCreate(savedInstanceState);
    // Edge-to-edge: WebView uses CSS safe-area (viewport-fit=cover in index.html).
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
  }
}
