package com.tatva.attendo

import android.content.Context
import android.os.Build
import com.tatva.attendo.data.remote.AttendoApi
import com.tatva.attendo.data.remote.AttendoRemote
import com.tatva.attendo.data.session.SessionManager
import com.tatva.attendo.data.store.JsonPendingStore
import com.tatva.attendo.data.store.JsonTokenStore
import com.tatva.attendo.data.store.KeystoreBlobStore
import com.tatva.attendo.domain.AttendanceRepository
import com.tatva.attendo.domain.DeviceDescriptor
import com.tatva.attendo.domain.LeaveRepository
import com.tatva.attendo.domain.MyDetailsRepository
import com.tatva.attendo.domain.PayrollRepository
import com.tatva.attendo.domain.TasksRepository
import com.tatva.attendo.domain.NotificationRepository
import com.tatva.attendo.data.local.AttendoDb
import com.tatva.attendo.data.local.RoomLocationQueue
import com.tatva.attendo.location.FusedLocationProvider
import com.tatva.attendo.tracking.AndroidHealthSource
import com.tatva.attendo.tracking.AndroidTrackingController
import com.tatva.attendo.tracking.HeartbeatReporter
import com.tatva.attendo.tracking.LocationQueue
import com.tatva.attendo.tracking.LocationUploader
import com.tatva.attendo.tracking.PrefsTrackingStore
import com.tatva.attendo.tracking.TrackingController
import com.tatva.attendo.tracking.TrackingStore
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient

/** Manual dependency container (single module, small graph - no DI framework needed). */
class AppContainer(context: Context) {
    private val app = context.applicationContext
    private val json = Json { ignoreUnknownKeys = true }
    private val blobs = KeystoreBlobStore(app)

    val remote: AttendoRemote = AttendoApi(
        baseUrl = BuildConfig.SUPABASE_URL,
        apiKey = BuildConfig.SUPABASE_KEY,
        client = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .build(),
        json = json,
    )

    val session = SessionManager(JsonTokenStore(blobs, json), remote)

    val locationQueue: LocationQueue = RoomLocationQueue(AttendoDb.create(app).locations())
    val trackingStore: TrackingStore = PrefsTrackingStore(app)
    val tracking: TrackingController = AndroidTrackingController(app, trackingStore)
    private val device = DeviceDescriptor(deviceUid(), Build.MODEL, Build.VERSION.RELEASE, BuildConfig.VERSION_NAME)

    val attendance = AttendanceRepository(
        session = session,
        remote = remote,
        pending = JsonPendingStore(blobs, json),
        location = FusedLocationProvider(app),
        device = device,
        tracking = tracking,
        trackingStore = trackingStore,
        queue = locationQueue,
    )

    val leave = LeaveRepository(session, remote)
    val notifications = NotificationRepository(session, remote)
    val myDetails = MyDetailsRepository(session, remote)
    val tasks = TasksRepository(session, remote)
    val payroll = PayrollRepository(session, remote)

    val uploader = LocationUploader(locationQueue, remote, session)
    val heartbeat = HeartbeatReporter(AndroidHealthSource(app, locationQueue, trackingStore), remote, session, device)

    private fun deviceUid(): String {
        val prefs = app.getSharedPreferences("attendo_device", Context.MODE_PRIVATE)
        return prefs.getString("uid", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("uid", it).apply() }
    }
}
