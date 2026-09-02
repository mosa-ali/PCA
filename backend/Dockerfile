FROM node:22.16.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
RUN npm run build
# Declared AFTER `npm ci`/`npm run build` on purpose: npm derives its own
# `omit=dev` config from NODE_ENV, so setting this any earlier would strip
# typescript/@types from the install and break the build step above.
#
# This is a security-relevant default, not a cosmetic one. The image runs
# `node dist/main.js` with whatever NODE_ENV the container inherits, and
# parentaccount/cookies.ts's isProductionEnvironment() gates the session
# and CSRF cookies' `Secure` attribute on exactly this value -- an unset
# NODE_ENV there fails OPEN (cookies served without `Secure`), unlike every
# other NODE_ENV gate in this codebase. An operator may still override it at
# `docker run` time; the image's own default must be the safe one.
ENV NODE_ENV=production
# Exec form invoking node DIRECTLY, not `npm run start`. With npm in front,
# npm is PID 1 and node is its child: PID 1 receives the orchestrator's
# SIGTERM and does not forward it, so src/runtime/gracefulShutdown.ts never
# runs and every deploy ends in a SIGKILL mid-request/mid-transaction after
# the termination grace period expires. Running node as PID 1 delivers the
# signal to the process that can actually drain the server and release the
# MySQL pool. Equivalent to package.json's "start" script by construction --
# keep the two in step.
CMD ["node", "dist/main.js"]
