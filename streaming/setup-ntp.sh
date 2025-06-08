#!/bin/sh
set -e
if [ "$(id -u)" -ne 0 ]; then
  echo "Execute este script como root ou via sudo"
  exit 1
fi
# Sync system time using NTP
timedatectl set-ntp true
timedatectl status
