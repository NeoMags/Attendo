package com.tatva.attendo.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.tatva.attendo.domain.DomainError
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/** Fused-location implementation. Needs a device/emulator with Play services; not covered by JVM tests. */
class FusedLocationProvider(private val context: Context) : LocationProvider {
    private val client = LocationServices.getFusedLocationProviderClient(context)

    @SuppressLint("MissingPermission")
    override suspend fun current(): Fix {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) throw DomainError.PermissionMissing()

        return suspendCancellableCoroutine { cont ->
            val cts = CancellationTokenSource()
            cont.invokeOnCancellation { cts.cancel() }
            client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                .addOnSuccessListener { loc ->
                    if (loc == null) {
                        cont.resumeWithException(DomainError.LocationUnavailable())
                    } else {
                        cont.resume(Fix(loc.latitude, loc.longitude, loc.accuracy, isMock(loc)))
                    }
                }
                .addOnFailureListener { cont.resumeWithException(DomainError.LocationUnavailable()) }
        }
    }

    /** Location.isMock exists from API 31; isFromMockProvider covers 26-30 (deprecated on 31+). */
    @Suppress("DEPRECATION")
    private fun isMock(loc: Location): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) loc.isMock else loc.isFromMockProvider
}
