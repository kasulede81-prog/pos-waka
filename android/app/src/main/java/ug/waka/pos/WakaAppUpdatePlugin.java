package ug.waka.pos;

import android.app.Activity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * Google Play In-App Updates API (flexible + immediate).
 * APK distribution remains on Google Play; this plugin only triggers official Play flows.
 */
@CapacitorPlugin(name = "WakaAppUpdate")
public class WakaAppUpdatePlugin extends Plugin {

  private AppUpdateManager appUpdateManager;
  private InstallStateUpdatedListener installListener;

  @Override
  public void load() {
    appUpdateManager = AppUpdateManagerFactory.create(getContext());
  }

  @Override
  protected void handleOnDestroy() {
    unregisterFlexibleListener();
    super.handleOnDestroy();
  }

  @PluginMethod
  public void checkForUpdate(PluginCall call) {
    appUpdateManager
      .getAppUpdateInfo()
      .addOnSuccessListener(info -> call.resolve(buildInfoObject(info)))
      .addOnFailureListener(e -> call.reject("check_failed", e));
  }

  @PluginMethod
  public void startFlexibleUpdate(PluginCall call) {
    registerFlexibleListener();
    appUpdateManager
      .getAppUpdateInfo()
      .addOnSuccessListener(
        info -> {
          if (!info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
            call.reject("flexible_not_allowed");
            return;
          }
          launchUpdateFlow(call, info, AppUpdateType.FLEXIBLE);
        }
      )
      .addOnFailureListener(e -> call.reject("start_failed", e));
  }

  @PluginMethod
  public void startImmediateUpdate(PluginCall call) {
    appUpdateManager
      .getAppUpdateInfo()
      .addOnSuccessListener(
        info -> {
          if (!info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
            call.reject("immediate_not_allowed");
            return;
          }
          launchUpdateFlow(call, info, AppUpdateType.IMMEDIATE);
        }
      )
      .addOnFailureListener(e -> call.reject("start_failed", e));
  }

  @PluginMethod
  public void completeFlexibleUpdate(PluginCall call) {
    appUpdateManager
      .completeUpdate()
      .addOnSuccessListener(
        unused -> {
          JSObject ret = new JSObject();
          ret.put("completed", true);
          call.resolve(ret);
        }
      )
      .addOnFailureListener(e -> call.reject("complete_failed", e));
  }

  @PluginMethod
  public void getInstallStatus(PluginCall call) {
    appUpdateManager
      .getAppUpdateInfo()
      .addOnSuccessListener(
        info -> {
          JSObject ret = new JSObject();
          ret.put("installStatus", info.installStatus());
          ret.put("availableVersionCode", info.availableVersionCode());
          call.resolve(ret);
        }
      )
      .addOnFailureListener(e -> call.reject("status_failed", e));
  }

  /** Play Core 2.x — startUpdateFlow returns Task<Integer> (activity result code). */
  private void launchUpdateFlow(PluginCall call, AppUpdateInfo info, int appUpdateType) {
    Activity activity = getActivity();
    if (activity == null) {
      call.reject("no_activity");
      return;
    }
    appUpdateManager
      .startUpdateFlow(
        info,
        activity,
        AppUpdateOptions.newBuilder(appUpdateType).setAllowAssetPackDeletion(true).build()
      )
      .addOnSuccessListener(
        resultCode -> {
          JSObject ret = new JSObject();
          ret.put("started", resultCode == Activity.RESULT_OK);
          ret.put("resultCode", resultCode);
          call.resolve(ret);
        }
      )
      .addOnFailureListener(e -> call.reject("start_failed", e));
  }

  private JSObject buildInfoObject(AppUpdateInfo info) {
    int availability = info.updateAvailability();
    boolean updateAvailable =
      availability == UpdateAvailability.UPDATE_AVAILABLE
        || availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS;
    JSObject ret = new JSObject();
    ret.put("updateAvailable", updateAvailable);
    ret.put("availableVersionCode", info.availableVersionCode());
    ret.put("installStatus", info.installStatus());
    ret.put("clientVersionStalenessDays", info.clientVersionStalenessDays());
    ret.put("flexibleAllowed", info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE));
    ret.put("immediateAllowed", info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE));
    return ret;
  }

  private void registerFlexibleListener() {
    if (installListener != null) return;
    installListener =
      state -> {
        if (state.installStatus() == InstallStatus.DOWNLOADED) {
          JSObject payload = new JSObject();
          payload.put("installStatus", state.installStatus());
          notifyListeners("flexibleUpdateDownloaded", payload);
        }
      };
    appUpdateManager.registerListener(installListener);
  }

  private void unregisterFlexibleListener() {
    if (installListener != null && appUpdateManager != null) {
      appUpdateManager.unregisterListener(installListener);
      installListener = null;
    }
  }
}
