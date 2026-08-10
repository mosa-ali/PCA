import { buildServer } from './http/buildServer.js';
import { AuthService } from './auth/AuthService.js';
import { PostgresAuthRepository } from './auth/PostgresAuthRepository.js';
import { AuthzService } from './authz/AuthzService.js';
import { PostgresAuthzRepository } from './authz/PostgresAuthzRepository.js';
import { InvitationService } from './invitation/InvitationService.js';
import { PostgresInvitationRepository } from './invitation/PostgresInvitationRepository.js';
import { EnrollmentCoordinator } from './enrollment/EnrollmentCoordinator.js';
import { PostgresEnrollmentCoordinatorRepository } from './enrollment/PostgresEnrollmentCoordinatorRepository.js';
import { PairingService } from './pairing/PairingService.js';
import { PostgresDeviceRepository } from './device/PostgresDeviceRepository.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '127.0.0.1';

if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

async function start(): Promise<void> {
  const app = buildServer({
    authService: new AuthService(new PostgresAuthRepository()),
    authzService: new AuthzService(new PostgresAuthzRepository()),
    invitationService: new InvitationService(new PostgresInvitationRepository()),
    enrollmentCoordinator: new EnrollmentCoordinator(new PostgresEnrollmentCoordinatorRepository()),
    pairingService: new PairingService(new PostgresDeviceRepository()),
  });
  await app.listen({ host, port });
}

void start();
