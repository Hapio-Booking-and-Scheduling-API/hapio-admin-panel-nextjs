import { describe, expect, it, vi } from "vitest"

import { applyValidationErrors, describeError, hasOwnMessage, HapioApiError, isHapioError } from "@/lib/hapio/errors"

const apiError = (init: Partial<ConstructorParameters<typeof HapioApiError>[0]> & { status: number }) =>
  new HapioApiError({ message: "", ...init })

describe("HapioApiError", () => {
  it("is an Error carrying every field from the response", () => {
    const error = new HapioApiError({
      status: 422,
      message: "Invalid.",
      code: "X",
      errors: { name: ["Required."] },
      messages: { "bookings.0": "Nope." },
      retryAfter: 3,
    })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("HapioApiError")
    expect(error.message).toBe("Invalid.")
    expect(error.status).toBe(422)
    expect(error.code).toBe("X")
    expect(error.errors).toEqual({ name: ["Required."] })
    expect(error.messages).toEqual({ "bookings.0": "Nope." })
    expect(error.retryAfter).toBe(3)
  })

  it("isValidation is true only for 422", () => {
    expect(apiError({ status: 422 }).isValidation).toBe(true)
    for (const status of [0, 400, 401, 404, 429, 500]) expect(apiError({ status }).isValidation).toBe(false)
  })

  it("isNotConfigured depends on the HAPIO_NOT_CONFIGURED code only", () => {
    expect(apiError({ status: 500, code: "HAPIO_NOT_CONFIGURED" }).isNotConfigured).toBe(true)
    expect(apiError({ status: 500 }).isNotConfigured).toBe(false)
    expect(apiError({ status: 500, code: "OTHER" }).isNotConfigured).toBe(false)
  })

  it("isHapioError narrows only HapioApiError instances", () => {
    expect(isHapioError(apiError({ status: 404 }))).toBe(true)
    expect(isHapioError(new Error("x"))).toBe(false)
    expect(isHapioError({ status: 404, message: "look-alike" })).toBe(false)
    expect(isHapioError(null)).toBe(false)
    expect(isHapioError(undefined)).toBe(false)
  })
})

describe("describeError", () => {
  it("returns the server message for a missing token, whatever the status", () => {
    const error = apiError({ status: 500, code: "HAPIO_NOT_CONFIGURED", message: "HAPIO_API_TOKEN is not set." })
    expect(describeError(error)).toBe("HAPIO_API_TOKEN is not set.")
  })

  it("returns the message of a 422, or 'Validation failed.' without one", () => {
    expect(describeError(apiError({ status: 422, message: "The name field is required." }))).toBe(
      "The name field is required."
    )
    expect(describeError(apiError({ status: 422 }))).toBe("Validation failed.")
  })

  it.each([
    [401, "The Hapio API token is missing or invalid."],
    [403, "The API token isn't allowed to do this. Check its abilities in the Hapio portal."],
    [404, "Not found. It may have been deleted."],
    [429, "Rate limit reached. Retrying shortly."],
    [500, "Hapio had an internal error."],
    [503, "Hapio is temporarily unavailable."],
  ])("uses the hint for %i when there is no message", (status, hint) => {
    expect(describeError(apiError({ status }))).toBe(hint)
  })

  it("replaces Laravel's bare 'Unauthenticated.' with the hint", () => {
    expect(describeError(apiError({ status: 401, message: "Unauthenticated." }))).toBe(
      "The Hapio API token is missing or invalid."
    )
  })

  it("replaces Laravel's bare 'Not found.' with the 404 hint", () => {
    for (const message of ["Not found.", "Not Found", " not found. "]) {
      expect(describeError(apiError({ status: 404, message }))).toBe("Not found. It may have been deleted.")
    }
  })

  it("prefers a specific server message over the hint", () => {
    expect(describeError(apiError({ status: 404, message: "Booking not found." }))).toBe("Booking not found.")
    expect(describeError(apiError({ status: 429, message: "Too Many Attempts." }))).toBe("Too Many Attempts.")
    expect(describeError(apiError({ status: 500, message: "Server Error" }))).toBe("Server Error")
  })

  it("keeps the abilities hint for a 403, after Hapio's own message", () => {
    const hint = "The API token isn't allowed to do this. Check its abilities in the Hapio portal."
    expect(describeError(apiError({ status: 403, message: "This action is unauthorized." }))).toBe(
      `This action is unauthorized. ${hint}`
    )
    expect(describeError(apiError({ status: 403, message: "Forbidden" }))).toBe(`Forbidden. ${hint}`)
    expect(describeError(apiError({ status: 403, message: hint }))).toBe(hint)
  })

  it("falls back to 'Request failed (status).' without message or hint", () => {
    expect(describeError(apiError({ status: 418 }))).toBe("Request failed (418).")
    expect(describeError(apiError({ status: 400 }))).toBe("Request failed (400).")
  })

  it("returns the network-error message for status 0", () => {
    expect(describeError(apiError({ status: 0, message: "Network error: could not reach the admin server." }))).toBe(
      "Network error: could not reach the admin server."
    )
  })

  it("returns the message of other errors and a generic text for anything else", () => {
    expect(describeError(new TypeError("Oops"))).toBe("Oops")
    expect(describeError("a string")).toBe("Something went wrong.")
    expect(describeError(undefined)).toBe("Something went wrong.")
    expect(describeError({ message: "plain object" })).toBe("Something went wrong.")
  })
})

describe("hasOwnMessage", () => {
  it("is false without a message, for Laravel's stock messages and for the status hint", () => {
    expect(hasOwnMessage(apiError({ status: 401 }))).toBe(false)
    expect(hasOwnMessage(apiError({ status: 401, message: "Unauthenticated." }))).toBe(false)
    expect(hasOwnMessage(apiError({ status: 404, message: "Not found" }))).toBe(false)
    expect(hasOwnMessage(apiError({ status: 401, message: "The Hapio API token is missing or invalid." }))).toBe(false)
  })

  it("is true for a message of the server's own", () => {
    expect(hasOwnMessage(apiError({ status: 401, message: "The demo has ended. Start a new one." }))).toBe(true)
  })
})

describe("applyValidationErrors", () => {
  const validation = (errors: Record<string, string[]>) =>
    apiError({ status: 422, message: "The given data was invalid.", errors })

  it("ignores errors that are not HapioApiErrors or carry no field errors", () => {
    const setError = vi.fn()
    expect(applyValidationErrors(new Error("x"), setError, ["name"])).toEqual([])
    expect(applyValidationErrors(apiError({ status: 422 }), setError, ["name"])).toEqual([])
    expect(applyValidationErrors(apiError({ status: 500, message: "x" }), setError, ["name"])).toEqual([])
    expect(setError).not.toHaveBeenCalled()
  })

  it("sets exact matches as server errors, joining several messages with a space", () => {
    const setError = vi.fn()
    const unmatched = applyValidationErrors(
      validation({ name: ["Required.", "Too short."], time_zone: ["Invalid."] }),
      setError,
      ["name", "time_zone"]
    )
    expect(unmatched).toEqual([])
    expect(setError).toHaveBeenCalledTimes(2)
    expect(setError).toHaveBeenNthCalledWith(1, "name", { type: "server", message: "Required. Too short." })
    expect(setError).toHaveBeenNthCalledWith(2, "time_zone", { type: "server", message: "Invalid." })
  })

  it("translates API keys through fieldMap", () => {
    const setError = vi.fn()
    const unmatched = applyValidationErrors(validation({ location: ["Pick a location."] }), setError, ["location_id"], {
      location: "location_id",
    })
    expect(unmatched).toEqual([])
    expect(setError).toHaveBeenCalledWith("location_id", { type: "server", message: "Pick a location." })
  })

  it("treats a fieldMap target that isn't a known field as unmatched", () => {
    const setError = vi.fn()
    const unmatched = applyValidationErrors(validation({ location: ["Pick a location."] }), setError, ["starts_at"], {
      location: "location_id",
    })
    expect(unmatched).toEqual(["Pick a location."])
    expect(setError).not.toHaveBeenCalled()
  })

  it("keeps a nested fieldMap target (service form: start_time.monday → start_times.monday)", () => {
    const setError = vi.fn()
    applyValidationErrors(validation({ "start_time.monday": ["Invalid time."] }), setError, ["start_times"], {
      "start_time.monday": "start_times.monday",
    })
    expect(setError).toHaveBeenCalledWith("start_times.monday", { type: "server", message: "Invalid time." })
  })

  it("matches nested keys whose root is a known field", () => {
    const setError = vi.fn()
    const unmatched = applyValidationErrors(validation({ "metadata.customer": ["Bad."] }), setError, ["metadata"])
    expect(unmatched).toEqual([])
    expect(setError).toHaveBeenCalledTimes(1)
    expect(setError).toHaveBeenCalledWith("metadata", { type: "server", message: "Bad." })
  })

  it("returns the messages of unknown fields without setting them", () => {
    const setError = vi.fn()
    const unmatched = applyValidationErrors(
      validation({ name: ["Required."], resource: ["Not available."], "bookings.0.starts_at": ["Taken."] }),
      setError,
      ["name"]
    )
    expect(unmatched).toEqual(["Not available.", "Taken."])
    expect(setError).toHaveBeenCalledTimes(1)
  })

  it("sets a nested key of an array field (resource_selection_priority.0) on the field itself", () => {
    // The location form renders one message for `resource_selection_priority` (an array of
    // ids). An error set on `resource_selection_priority.0` would never be displayed.
    const setError = vi.fn()
    applyValidationErrors(
      validation({ "resource_selection_priority.0": ["The selected resource is invalid."] }),
      setError,
      ["name", "time_zone", "resource_selection_strategy", "resource_selection_priority", "metadata"]
    )
    expect(setError).toHaveBeenCalledWith("resource_selection_priority", {
      type: "server",
      message: "The selected resource is invalid.",
    })
  })

  it("joins the messages of several nested keys (and the field's own) on the root field", () => {
    const setError = vi.fn()
    const unmatched = applyValidationErrors(
      validation({
        resource_selection_priority: ["Too many ids."],
        "resource_selection_priority.0": ["The first resource is invalid."],
        "resource_selection_priority.2": ["The third resource is invalid."],
        name: ["Required."],
      }),
      setError,
      ["name", "resource_selection_priority"]
    )
    expect(unmatched).toEqual([])
    expect(setError).toHaveBeenCalledTimes(2)
    expect(setError).toHaveBeenNthCalledWith(1, "resource_selection_priority", {
      type: "server",
      message: "Too many ids. The first resource is invalid. The third resource is invalid.",
    })
    expect(setError).toHaveBeenNthCalledWith(2, "name", { type: "server", message: "Required." })
  })
})
