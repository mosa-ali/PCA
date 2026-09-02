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
CMD ["npm", "run", "start"]
