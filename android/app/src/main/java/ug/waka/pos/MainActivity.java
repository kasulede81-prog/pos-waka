package ug.waka.pos;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    SplashScreen.installSplashScreen(this);
    registerPlugin(WakaMlkitOcrPlugin.class);
    registerPlugin(WakaAppUpdatePlugin.class);
    // Android 15: enableEdgeToEdge() replaces WindowCompat.setDecorFitsSystemWindows.
    // Capacitor SystemBars + CSS env(safe-area-inset-*) still own inset handling.
    EdgeToEdge.enable(this);
    super.onCreate(savedInstanceState);
  }
}
