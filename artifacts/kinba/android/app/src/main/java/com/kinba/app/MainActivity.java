package com.kinba.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super.onCreate so the bridge includes it when it loads.
        registerPlugin(GalleryDownloadPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
