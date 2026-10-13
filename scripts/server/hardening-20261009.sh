#!/bin/bash
# RECORD ONLY: already applied on 2026-10-09. Do not re-run (see docs/OPERATIONS.md).
# Server hardening fixes from the 2026-10-09 audit of 213.246.45.75.
# Run with:  ssh -i ~/.ssh/SebMouadSSH root@213.246.45.75 'bash -s' < server-fixes.sh
# Everything touched is backed up to /root/audit-fix-20261009 first.
set -euo pipefail

B=/root/audit-fix-20261009
L=/usr/local/lsws
SITES="newsgeet.com desomemes.com goltaf.com"
WPQ="wp --allow-root --skip-plugins --skip-themes"
CF_V4="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22"
CF_V6="2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32"
step() { echo; echo "=== $*"; }

step "0. Backup"
mkdir -p "$B"
cp -a /etc/nftables.conf /root/.ssh/authorized_keys $L/conf/httpd_config.conf \
      $L/conf/vhosts/phpmyadmin/vhconf.conf /etc/postfix/main.cf /etc/systemd/journald.conf "$B"/
for s in $SITES; do mkdir -p "$B/$s"; cp -a /www/$s/wp-config.php /www/$s/.htaccess "$B/$s"/; done
ls "$B"

step "1. SSH: remove mstc-diag key and blank lines"
grep -v "mstc-diag-readonly-20260721" "$B/authorized_keys" | grep -v '^\s*$' > /root/.ssh/authorized_keys.new
grep -q "SebMouad\|AAAAB3NzaC1yc2E" /root/.ssh/authorized_keys.new   # abort if the RSA key went missing
chmod 600 /root/.ssh/authorized_keys.new && mv /root/.ssh/authorized_keys.new /root/.ssh/authorized_keys
ssh-keygen -lf /root/.ssh/authorized_keys

step "2. phpMyAdmin: remove setup/, restrict to Morocco IPs"
[ -d /www/phpMyAdmin/setup ] && mv /www/phpMyAdmin/setup "$B/phpMyAdmin-setup"
# Trust Cloudflare's proxy header so OLS sees the real visitor IP (useIpInProxyHeader=2 is already set)
[ "$(grep -c '^  allow                   ALL$' $L/conf/httpd_config.conf)" = 1 ]
CF_T=$(for n in $CF_V4 $CF_V6; do printf ', %sT' "$n"; done)
sed -i "s|^  allow                   ALL\$|  allow                   ALL${CF_T}|" $L/conf/httpd_config.conf
MA=$(sed -n 's/^define MOROCCO_V4 = { \(.*\) }$/\1/p' /etc/nftables.conf)
[ -n "$MA" ]
grep -q accessControl $L/conf/vhosts/phpmyadmin/vhconf.conf || cat >> $L/conf/vhosts/phpmyadmin/vhconf.conf <<EOF

accessControl  {
  allow                   $MA
  deny                    ALL
}
EOF

step "3. WordPress users"
# Reassign all content of the claude-* admins to Mouad, then delete them
for pair in desomemes.com:claude-dev newsgeet.com:claude-audit; do
  s=${pair%%:*}; u=${pair#*:}
  M=$($WPQ --path=/www/$s user get Mouad --field=ID)
  echo "$s: $u owns $($WPQ --path=/www/$s post list --author=$($WPQ --path=/www/$s user get $u --field=ID) --post_type=any --post_status=any --format=count) posts -> Mouad (ID $M)"
  $WPQ --path=/www/$s user delete $u --reassign=$M --yes
done

step "4. WordPress hardening: DISALLOW_FILE_EDIT + block xmlrpc"
for s in $SITES; do
  $WPQ --path=/www/$s config set DISALLOW_FILE_EDIT true --raw --type=constant
  if ! grep -q "BEGIN Block xmlrpc" /www/$s/.htaccess; then
    { printf '# BEGIN Block xmlrpc\nRewriteEngine On\nRewriteRule ^xmlrpc\\.php$ - [F,L]\n# END Block xmlrpc\n\n'; cat "$B/$s/.htaccess"; } > /www/$s/.htaccess
  fi
  stat -c "%U %a %n" /www/$s/wp-config.php /www/$s/.htaccess
done
[ -f /www/goltaf.com/wp-admin/.pid ] && mv /www/goltaf.com/wp-admin/.pid "$B/goltaf-wp-admin.pid"

step "5. Update Astra theme (as nobody, to keep file ownership)"
runuser -u nobody -- env HOME=/tmp wp --path=/www/goltaf.com theme update astra

step "6. Postfix: localhost only (outgoing WordPress mail unaffected)"
postconf -e inet_interfaces=loopback-only
systemctl restart postfix

step "7. Firewall: 80/443 only from Cloudflare, close 25"
NEW=/etc/nftables.conf.new
{
  sed -n '1,/^define MOROCCO_V4/p' /etc/nftables.conf
  echo "define CLOUDFLARE_V4 = { $(echo $CF_V4 | sed 's/ /, /g') }"
  echo "define CLOUDFLARE_V6 = { $(echo $CF_V6 | sed 's/ /, /g') }"
  sed -n '/^table inet filter/,$p' /etc/nftables.conf \
   | sed -e '/# SMTP: must stay open/,/tcp dport 25 accept/d' \
         -e 's|# Public web: open to all|# Public web: Cloudflare only (sites are all proxied; blocks origin bypass)|' \
         -e 's|^        tcp dport 80 accept$|        tcp dport { 80, 443 } ip saddr $CLOUDFLARE_V4 accept|' \
         -e 's|^        tcp dport 443 accept$|        tcp dport { 80, 443 } ip6 saddr $CLOUDFLARE_V6 accept|'
} > $NEW
grep -q 'CLOUDFLARE_V4 accept' $NEW && grep -q 'tcp dport 22' $NEW && ! grep -q 'dport 25' $NEW
nft -c -f $NEW
mv $NEW /etc/nftables.conf
nft -f /etc/nftables.conf
systemctl restart fail2ban          # the flush removed its table; restart re-creates it and restores bans
sleep 3; fail2ban-client status sshd | grep -E "Currently banned"

step "8. Housekeeping"
systemctl disable AutoconfDownloader.service || true
systemctl reset-failed AutoconfDownloader.service || true
sed -i 's/^SystemMaxUse=1G/SystemMaxUse=4G/' /etc/systemd/journald.conf
systemctl restart systemd-journald

step "9. Restart OpenLiteSpeed and verify"
$L/bin/lswsctrl restart; sleep 4
tail -n 5 $L/logs/error.log
for h in recettes.newsgeet.com recettes.desomemes.com recettes.goltaf.com; do
  echo "$h xmlrpc: $(curl -sk -o /dev/null -w %{http_code} -X POST --resolve $h:443:127.0.0.1 https://$h/xmlrpc.php)"
done
systemctl --failed --no-legend
echo; echo "Done. Backups in $B"
