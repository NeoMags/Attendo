package com.tatva.attendo.tracking

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.tatva.attendo.AttendoApp
import java.util.concurrent.TimeUnit

/** Safety net independent of the foreground service: pending check-in/out, queued points, heartbeat. */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as AttendoApp).container
        val owner = c.session.ownerKey() ?: return Result.success()
        return try {
            c.attendance.syncPending()
            c.uploader.flush(owner)
            c.heartbeat.send(owner)
            Result.success()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.retry()
        }
    }
}

object SyncScheduler {
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Every 15 min (WorkManager's minimum). Safe to call repeatedly. */
    fun ensurePeriodic(context: Context) {
        val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("attendo-sync", ExistingPeriodicWorkPolicy.KEEP, req)
    }

    /** One immediate run (e.g. final upload after check-out). */
    fun kick(context: Context) {
        val req = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(online).build()
        WorkManager.getInstance(context).enqueueUniqueWork("attendo-sync-now", ExistingWorkPolicy.REPLACE, req)
    }
}
