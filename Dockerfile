FROM oven/bun:1.2

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .
RUN chmod +x docker/entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3100

EXPOSE 3100

CMD ["sh", "docker/entrypoint.sh"]
