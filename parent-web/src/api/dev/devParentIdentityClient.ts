import type { ParentIdentityClient, ParentIdentityProfile } from '../interfaces';

export class DevParentIdentityClient implements ParentIdentityClient {
  private profile: ParentIdentityProfile = {
    firstName: 'Dev',
    lastName: 'Parent',
    email: 'dev.parent@example.test',
    phoneNumber: null,
    emailVerified: true,
    phoneVerified: false,
  };

  async get(): Promise<ParentIdentityProfile> {
    return { ...this.profile };
  }

  async updateNames(input: { firstName: string; lastName: string }): Promise<ParentIdentityProfile> {
    this.profile = { ...this.profile, firstName: input.firstName.trim(), lastName: input.lastName.trim() };
    return { ...this.profile };
  }
}
