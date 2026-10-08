# ADR 0001: Anyo WorldDocument Is Authoritative

**Status:** Accepted

Persistent world meaning is stored in a versioned, serializable Anyo `WorldDocument`. `CompiledWorld`, editor views, and renderer-native objects are derived projections.

This allows deterministic migration, validation, stable patches, server-side processing, renderer replacement, editor independence, and portable world packages.
