/**
 * An error whose `message` is written for the person looking at the page.
 * `DataState` (packages/ui) shows the message of an error carrying
 * `userFacing: true`; every other error's raw text stays hidden behind its
 * friendly default copy (QA-1 F-23). Use this for failures a query function
 * can describe to a human (MAP-20, SEC-11); never for a raw server message.
 */
export class UserFacingError extends Error {
  readonly userFacing = true;

  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}
