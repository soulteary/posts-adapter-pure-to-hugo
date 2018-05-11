FROM ubuntu:16.04
RUN ln -sf /bin/bash /bin/sh

MAINTAINER soulteary <soulteary@gmail.com>

RUN apt-get update && apt-get install -y curl git

ARG NODE_VERSION=10.1.0
RUN curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.8/install.sh | bash \
    && source $HOME/.nvm/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias $NODE_VERSION \
    && npm cache clean --force

WORKDIR /app

ADD ./package.json /app
ADD ./package-lock.json /app

RUN source $HOME/.nvm/nvm.sh && \
    npm install

ADD . /app

CMD source $HOME/.nvm/nvm.sh && \
    npm start
