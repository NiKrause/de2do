export class SessionRequiredError extends Error {
  constructor(message = 'Threshold session is required') {
    super(message)
    this.name = 'SessionRequiredError'
  }
}

export class DecryptFailedError extends Error {
  constructor(message = 'Failed to decrypt payload') {
    super(message)
    this.name = 'DecryptFailedError'
  }
}

export class UnsupportedCipherVersionError extends Error {
  constructor(message = 'Unsupported cipher version') {
    super(message)
    this.name = 'UnsupportedCipherVersionError'
  }
}
