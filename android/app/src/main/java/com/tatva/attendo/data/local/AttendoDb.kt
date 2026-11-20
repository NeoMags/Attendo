package com.tatva.attendo.data.local

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import com.tatva.attendo.tracking.LocationQueue
import com.tatva.attendo.tracking.QueuedPoint

@Entity(tableName = "queued_location")
data class LocationEntity(
    @PrimaryKey val id: String,
    val ownerKey: String,
    val sessionId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float?,
    val speed: Float?,
    val bearing: Float?,
    val altitude: Double?,
    val battery: Int?,
    val provider: String?,
    val network: String?,
    val isMock: Boolean,
    val recordedAtMs: Long,
)

@Dao
interface LocationDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(e: LocationEntity)

    @Query("SELECT * FROM queued_location WHERE ownerKey = :owner ORDER BY recordedAtMs ASC LIMIT :limit")
    suspend fun next(owner: String, limit: Int): List<LocationEntity>

    @Query("DELETE FROM queued_location WHERE id IN (:ids)")
    suspend fun remove(ids: List<String>)

    @Query("DELETE FROM queued_location WHERE sessionId = :sessionId")
    suspend fun removeSession(sessionId: String)

    @Query("SELECT COUNT(*) FROM queued_location WHERE ownerKey = :owner")
    suspend fun count(owner: String): Int

    @Query("SELECT MIN(recordedAtMs) FROM queued_location WHERE ownerKey = :owner")
    suspend fun oldest(owner: String): Long?
}

@Database(entities = [LocationEntity::class], version = 1, exportSchema = false)
abstract class AttendoDb : RoomDatabase() {
    abstract fun locations(): LocationDao

    companion object {
        fun create(context: Context): AttendoDb =
            Room.databaseBuilder(context.applicationContext, AttendoDb::class.java, "attendo.db").build()
    }
}

class RoomLocationQueue(private val dao: LocationDao) : LocationQueue {
    override suspend fun add(p: QueuedPoint) = dao.insert(
        LocationEntity(p.id, p.ownerKey, p.sessionId, p.latitude, p.longitude, p.accuracy, p.speed, p.bearing,
            p.altitude, p.battery, p.provider, p.network, p.isMock, p.recordedAtMs),
    )

    override suspend fun next(ownerKey: String, limit: Int) = dao.next(ownerKey, limit).map {
        QueuedPoint(it.id, it.ownerKey, it.sessionId, it.latitude, it.longitude, it.accuracy, it.speed, it.bearing,
            it.altitude, it.battery, it.provider, it.network, it.isMock, it.recordedAtMs)
    }

    override suspend fun remove(ids: List<String>) = ids.chunked(500).forEach { dao.remove(it) }
    override suspend fun removeSession(sessionId: String) = dao.removeSession(sessionId)
    override suspend fun count(ownerKey: String) = dao.count(ownerKey)
    override suspend fun oldestMs(ownerKey: String) = dao.oldest(ownerKey)
}
