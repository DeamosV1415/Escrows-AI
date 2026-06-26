/** A billing error carrying an HTTP status for the route layer. */
export class BillingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
