package com.tatva.attendo.data.store

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Small encrypted key/value store (AndroidKeystore in production, in-memory in tests). */
interface BlobStore {
    fun get(name: String): String?
    fun put(name: String, value: String)
    fun remove(name: String)
}

@Serializable
data class StoredSession(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtMs: Long,
    val mustChangePassword: Boolean,
    /** "company:employeeCode" (lower-case). Binds local pending data to the signed-in employee. */
    val ownerKey: String,
)

interface TokenStore {
    fun load(): StoredSession?
    fun save(session: StoredSession)
    fun clear()
}

class JsonTokenStore(private val blobs: BlobStore, private val json: Json) : TokenStore {
    override fun load(): StoredSession? =
        blobs.get(KEY)?.let { runCatching { json.decodeFromString<StoredSession>(it) }.getOrNull() }

    override fun save(session: StoredSession) = blobs.put(KEY, json.encodeToString(StoredSession.serializer(), session))
    override fun clear() = blobs.remove(KEY)

    private companion object { const val KEY = "session" }
}

/** A check-in captured on the device but not yet confirmed by the server. Re-sent with the SAME ids. */
@Serializable
data class PendingCheckIn(
    val ownerKey: String,
    val attendanceId: String,
    val sessionId: String,
    val recordedAtIso: String,
    val lat: Double,
    val lng: Double,
    val accuracyM: Float,
)

@Serializable
data class PendingCheckOut(
    val ownerKey: String,
    val attendanceId: String,
    val recordedAtIso: String,
    val lat: Double? = null,
    val lng: Double? = null,
    val accuracyM: Float? = null,
)

interface PendingStore {
    fun checkIn(): PendingCheckIn?
    fun saveCheckIn(p: PendingCheckIn)
    fun clearCheckIn()
    fun checkOut(): PendingCheckOut?
    fun saveCheckOut(p: PendingCheckOut)
    fun clearCheckOut()
}

class JsonPendingStore(private val blobs: BlobStore, private val json: Json) : PendingStore {
    override fun checkIn(): PendingCheckIn? =
        blobs.get(IN)?.let { runCatching { json.decodeFromString<PendingCheckIn>(it) }.getOrNull() }

    override fun saveCheckIn(p: PendingCheckIn) = blobs.put(IN, json.encodeToString(PendingCheckIn.serializer(), p))
    override fun clearCheckIn() = blobs.remove(IN)

    override fun checkOut(): PendingCheckOut? =
        blobs.get(OUT)?.let { runCatching { json.decodeFromString<PendingCheckOut>(it) }.getOrNull() }

    override fun saveCheckOut(p: PendingCheckOut) = blobs.put(OUT, json.encodeToString(PendingCheckOut.serializer(), p))
    override fun clearCheckOut() = blobs.remove(OUT)

    private companion object {
        const val IN = "pending_check_in"
        const val OUT = "pending_check_out"
    }
}
