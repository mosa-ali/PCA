export type Platform = 'ANDROID' | 'IOS';

export interface EnrollDeviceInput {
  rawInvitationToken: string;
  platform: Platform;
  publicKey: string;
}

export interface EnrollDeviceResult {
  deviceId: string;
  keyId: string;
  familyId: string;
  invitationId: string;
}
