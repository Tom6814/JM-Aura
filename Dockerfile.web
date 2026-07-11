FROM node:20-alpine AS deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
COPY api/package.json ./api/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm ci

FROM deps AS build
COPY . .

RUN npm --workspace web run build

FROM node:20-alpine AS runtime
WORKDIR /repo

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/package-lock.json ./package-lock.json
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/web ./web

CMD ["npm", "--workspace", "web", "run", "start"]
