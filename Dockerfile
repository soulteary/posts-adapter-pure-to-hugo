FROM node:9.10.0-alpine

MAINTAINER soulteary <soulteary@gmail.com>

ADD . /app

WORKDIR /app

RUN npm install

CMD [ "/app/bin/convert", "--use-config", "true" ]
