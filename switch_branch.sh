#!/bin/bash

git checkout main
git pull origin main
git pull --rebase --autostash 

git checkout -b $1
git branch -D $2