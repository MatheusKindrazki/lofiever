#!/bin/sh
# Sync system time using NTP
sudo timedatectl set-ntp true
sudo timedatectl status
