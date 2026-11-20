package com.tatva.attendo.location

data class Fix(val lat: Double, val lng: Double, val accuracyM: Float, val isMock: Boolean)

interface LocationProvider {
    /**
     * One fresh high-accuracy fix.
     * @throws com.tatva.attendo.domain.DomainError.PermissionMissing / LocationUnavailable
     */
    suspend fun current(): Fix
}
